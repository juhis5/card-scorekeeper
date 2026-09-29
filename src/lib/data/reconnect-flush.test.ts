import { beforeEach, describe, expect, it, vi } from 'vitest'

const ensureSignedInMock = vi.fn()
const writeGameResultMock = vi.fn()
const flushPendingResultsMock = vi.fn()
const readPendingResultsMock = vi.fn()
const getFirebaseAuthMock = vi.fn(() => 'auth-instance')
const publishHighscoresMock = vi.fn()
const flushPendingHighscoresMock = vi.fn()
const readPendingHighscoresMock = vi.fn()
const reportHandledErrorMock = vi.fn()
const appendPendingHighscoresMock = vi.fn()
const readInviteMock = vi.fn()
const readInviteGameMock = vi.fn()
const countInviteMock = vi.fn()

vi.mock('./invites', () => ({
  readInvite: (...args: unknown[]) => readInviteMock(...args),
  readInviteGame: (...args: unknown[]) => readInviteGameMock(...args),
  countInvite: (...args: unknown[]) => countInviteMock(...args),
}))

vi.mock('../platform/error-reporting', () => ({
  reportHandledError: (...args: unknown[]) => reportHandledErrorMock(...args),
}))

vi.mock('./firebase', () => ({
  getFirebaseAuth: () => getFirebaseAuthMock(),
  getDb: () => 'db-instance',
  ensureSignedIn: (...args: unknown[]) => ensureSignedInMock(...args),
}))

vi.mock('./firestore-stats', () => ({
  writeGameResult: (...args: unknown[]) => writeGameResultMock(...args),
  publishHighscores: (...args: unknown[]) => publishHighscoresMock(...args),
}))

vi.mock('./pending-results', () => ({
  flushPendingResults: (...args: unknown[]) => flushPendingResultsMock(...args),
  readPendingResults: (...args: unknown[]) => readPendingResultsMock(...args),
  flushPendingHighscores: (...args: unknown[]) => flushPendingHighscoresMock(...args),
  readPendingHighscores: (...args: unknown[]) => readPendingHighscoresMock(...args),
  appendPendingHighscores: (...args: unknown[]) => appendPendingHighscoresMock(...args),
}))

const {
  countAcceptedInvites,
  uploadPendingHighscores,
  uploadPendingResults,
  UPLOAD_WRITE_TIMEOUT_MS,
} = await import('./reconnect-flush')
const { readAcceptedInvites, rememberAcceptedInvite } = await import('./accepted-invites')

beforeEach(() => {
  vi.clearAllMocks()
  readPendingResultsMock.mockReturnValue([{ result: { gameId: 'queued' }, players: [] }])
  readPendingHighscoresMock.mockReturnValue([{ result: { gameId: 'queued' }, players: [] }])
})

describe('uploadPendingResults', () => {
  it('reports how many games went up', async () => {
    flushPendingResultsMock.mockResolvedValue({ flushed: 2, failed: 0, remaining: 0 })

    await expect(uploadPendingResults()).resolves.toBe(2)
  })

  it('gives up on a write that hangs, so an offline upload never stays in flight', async () => {
    vi.useFakeTimers()
    ensureSignedInMock.mockResolvedValue('uid-1')
    writeGameResultMock.mockReturnValue(new Promise(() => {}))
    let writeError: unknown
    flushPendingResultsMock.mockImplementation(async (_storage: unknown, writer: unknown) => {
      await (writer as { write: (e: unknown) => Promise<void> })
        .write({ result: { gameId: 'g1' }, players: [] })
        .catch((error: unknown) => {
          writeError = error
        })
      return { flushed: 0, failed: 0, remaining: 1 }
    })

    const upload = uploadPendingResults()
    await vi.advanceTimersByTimeAsync(UPLOAD_WRITE_TIMEOUT_MS)

    await expect(upload).resolves.toBe(0)
    expect(writeError).toMatchObject({ code: 'deadline-exceeded' })
    vi.useRealTimers()
  })

  it('never touches Firebase when nothing is queued', async () => {
    readPendingResultsMock.mockReturnValue([])

    await expect(uploadPendingResults()).resolves.toBe(0)

    expect(getFirebaseAuthMock).not.toHaveBeenCalled()
    expect(flushPendingResultsMock).not.toHaveBeenCalled()
  })

  it('flushes the queue using a writer that signs in and then writes the game result', async () => {
    ensureSignedInMock.mockResolvedValue('uid-1')
    writeGameResultMock.mockResolvedValue(undefined)
    const entry = { result: { gameId: 'g1' }, players: [] }
    flushPendingResultsMock.mockImplementation(async (_storage: unknown, writer: unknown) => {
      await (writer as { write: (e: typeof entry) => Promise<void> }).write(entry)
      return { flushed: 1, remaining: 0 }
    })

    await uploadPendingResults()

    expect(ensureSignedInMock).toHaveBeenCalledWith('auth-instance')
    expect(writeGameResultMock).toHaveBeenCalledWith('db-instance', { gameId: 'g1' }, [])
  })

  it("overwrites each queued row's deviceUuid with the freshly-signed-in uid, not whatever was queued", async () => {
    ensureSignedInMock.mockResolvedValue('current-uid')
    writeGameResultMock.mockResolvedValue(undefined)
    const entry = {
      result: { gameId: 'g1' },
      players: [
        { gameId: 'g1', deviceUuid: 'stale-queued-uuid', displayName: 'Host', finalScore: 10 },
      ],
    }
    flushPendingResultsMock.mockImplementation(async (_storage: unknown, writer: unknown) => {
      await (writer as { write: (e: typeof entry) => Promise<void> }).write(entry)
      return { flushed: 1, remaining: 0 }
    })

    await uploadPendingResults()

    expect(writeGameResultMock).toHaveBeenCalledWith('db-instance', { gameId: 'g1' }, [
      { gameId: 'g1', deviceUuid: 'current-uid', displayName: 'Host', finalScore: 10 },
    ])
  })

  it('never throws when the flush itself rejects (still offline, or a write failed)', async () => {
    flushPendingResultsMock.mockRejectedValue(new Error('offline'))

    await expect(uploadPendingResults()).resolves.toBe(0)
  })

  it('never throws when loading firebase fails outright', async () => {
    ensureSignedInMock.mockImplementation(() => {
      throw new Error('bad config')
    })
    flushPendingResultsMock.mockImplementation(async (_storage: unknown, writer: unknown) => {
      await (writer as { write: (e: unknown) => Promise<void> }).write({
        result: { gameId: 'g1' },
        players: [],
      })
      return { flushed: 0, remaining: 1 }
    })

    await expect(uploadPendingResults()).resolves.toBe(0)
  })

  it('reports a failed upload as handled, so the queue waits quietly for the next try', async () => {
    const offline = new Error('offline')
    flushPendingResultsMock.mockRejectedValue(offline)

    await uploadPendingResults()

    expect(reportHandledErrorMock).toHaveBeenCalledWith(offline, 'upload-pending-results')
  })
})

describe('uploadPendingHighscores', () => {
  it('never touches Firebase when no highscores are queued', async () => {
    readPendingHighscoresMock.mockReturnValue([])

    await uploadPendingHighscores()

    expect(ensureSignedInMock).not.toHaveBeenCalled()
    expect(flushPendingHighscoresMock).not.toHaveBeenCalled()
  })

  it('signs in before flushing, so the publish runs as an authenticated user', async () => {
    const calls: string[] = []
    ensureSignedInMock.mockImplementation(async () => calls.push('sign-in'))
    flushPendingHighscoresMock.mockImplementation(async () => calls.push('flush'))

    await uploadPendingHighscores()

    expect(calls).toEqual(['sign-in', 'flush'])
  })

  it('publishes each queued entry to the highscores with its result and players', async () => {
    ensureSignedInMock.mockResolvedValue('uid-1')
    publishHighscoresMock.mockResolvedValue(undefined)
    const entry = {
      result: { gameId: 'g1' },
      players: [{ gameId: 'g1', deviceUuid: 'uid-1', displayName: 'Host', finalScore: 10 }],
    }
    flushPendingHighscoresMock.mockImplementation(async (_storage: unknown, publisher: unknown) => {
      await (publisher as { publish: (e: typeof entry) => Promise<void> }).publish(entry)
    })

    await uploadPendingHighscores()

    expect(publishHighscoresMock).toHaveBeenCalledWith('db-instance', entry.result, entry.players)
  })

  it('never throws when signing in fails, and reports it as handled', async () => {
    const signInFailure = new Error('offline')
    ensureSignedInMock.mockRejectedValue(signInFailure)

    await expect(uploadPendingHighscores()).resolves.toBeUndefined()

    expect(flushPendingHighscoresMock).not.toHaveBeenCalled()
    expect(reportHandledErrorMock).toHaveBeenCalledWith(signInFailure, 'upload-pending-highscores')
  })
})

describe('countAcceptedInvites', () => {
  const invite = (id: string, status = 'accepted') => ({
    id,
    gameId: id.split('_')[0],
    guestId: 'guest-1',
    status,
  })
  const counted = (gameId: string) => ({
    result: { gameId, finishedAt: 'x', totalRounds: 5 },
    row: { gameId, deviceUuid: 'uid-juho' },
  })

  beforeEach(() => {
    localStorage.clear()
    ensureSignedInMock.mockResolvedValue('uid-juho')
    publishHighscoresMock.mockResolvedValue([])
  })

  it('loads nothing with no invite waiting', async () => {
    await expect(countAcceptedInvites()).resolves.toBe(0)
    expect(ensureSignedInMock).not.toHaveBeenCalled()
  })

  it('counts and publishes finished games one at a time, keeping one still running', async () => {
    rememberAcceptedInvite(localStorage, 'FINIS_guest-1')
    rememberAcceptedInvite(localStorage, 'PLAYS_guest-1')
    readInviteMock.mockImplementation((_db: unknown, id: string) => Promise.resolve(invite(id)))
    readInviteGameMock.mockImplementation((_db: unknown, gameId: string) =>
      Promise.resolve(gameId === 'FINIS' ? 'finished' : 'running'),
    )
    countInviteMock.mockResolvedValue(counted('FINIS'))

    await expect(countAcceptedInvites()).resolves.toBe(1)

    expect(countInviteMock).toHaveBeenCalledWith('db-instance', 'uid-juho', invite('FINIS_guest-1'))
    expect(publishHighscoresMock).toHaveBeenCalledWith('db-instance', counted('FINIS').result, [
      counted('FINIS').row,
    ])
    expect(readAcceptedInvites(localStorage)).toEqual(['PLAYS_guest-1'])
  })

  it('queues a public entry that failed to publish, to retry with the others', async () => {
    rememberAcceptedInvite(localStorage, 'FINIS_guest-1')
    readInviteMock.mockResolvedValue(invite('FINIS_guest-1'))
    readInviteGameMock.mockResolvedValue('finished')
    countInviteMock.mockResolvedValue(counted('FINIS'))
    publishHighscoresMock.mockResolvedValue([counted('FINIS').row])

    await countAcceptedInvites()

    expect(appendPendingHighscoresMock).toHaveBeenCalledWith(expect.anything(), {
      result: counted('FINIS').result,
      players: [counted('FINIS').row],
    })
  })

  it('drops an invite answered elsewhere, gone, or whose game ended without a result', async () => {
    rememberAcceptedInvite(localStorage, 'GONE0_guest-1')
    rememberAcceptedInvite(localStorage, 'DECLI_guest-1')
    rememberAcceptedInvite(localStorage, 'ENDED_guest-1')
    readInviteMock.mockImplementation((_db: unknown, id: string) =>
      Promise.resolve(
        id.startsWith('GONE0')
          ? null
          : invite(id, id.startsWith('DECLI') ? 'declined' : 'accepted'),
      ),
    )
    readInviteGameMock.mockResolvedValue('ended')

    await expect(countAcceptedInvites()).resolves.toBe(0)

    expect(countInviteMock).not.toHaveBeenCalled()
    expect(readAcceptedInvites(localStorage)).toEqual([])
  })

  it('keeps a finished game whose result has not landed yet', async () => {
    rememberAcceptedInvite(localStorage, 'FINIS_guest-1')
    readInviteMock.mockResolvedValue(invite('FINIS_guest-1'))
    readInviteGameMock.mockResolvedValue('finished')
    countInviteMock.mockResolvedValue(null)

    await countAcceptedInvites()

    expect(readAcceptedInvites(localStorage)).toEqual(['FINIS_guest-1'])
  })

  it('keeps everything waiting and reports it when a read fails', async () => {
    rememberAcceptedInvite(localStorage, 'FINIS_guest-1')
    const offline = new Error('offline')
    readInviteMock.mockRejectedValue(offline)

    await expect(countAcceptedInvites()).resolves.toBe(0)

    expect(readAcceptedInvites(localStorage)).toEqual(['FINIS_guest-1'])
    expect(reportHandledErrorMock).toHaveBeenCalledWith(offline, 'count-accepted-invites')
  })
})
