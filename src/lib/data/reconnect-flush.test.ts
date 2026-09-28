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
}))

const { uploadPendingHighscores, uploadPendingResults, UPLOAD_WRITE_TIMEOUT_MS } =
  await import('./reconnect-flush')

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
