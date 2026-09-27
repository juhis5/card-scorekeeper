import { beforeEach, describe, expect, it, vi } from 'vitest'

const ensureSignedInMock = vi.fn()
const writeGameResultMock = vi.fn()
const flushPendingResultsMock = vi.fn()
const readPendingResultsMock = vi.fn()
const getFirebaseAuthMock = vi.fn(() => 'auth-instance')

vi.mock('./firebase', () => ({
  getFirebaseAuth: () => getFirebaseAuthMock(),
  getDb: () => 'db-instance',
  ensureSignedIn: (...args: unknown[]) => ensureSignedInMock(...args),
}))

vi.mock('./firestore-stats', () => ({
  writeGameResult: (...args: unknown[]) => writeGameResultMock(...args),
}))

vi.mock('./pending-results', () => ({
  flushPendingResults: (...args: unknown[]) => flushPendingResultsMock(...args),
  readPendingResults: (...args: unknown[]) => readPendingResultsMock(...args),
}))

const { flushPendingResultsOnLaunch } = await import('./reconnect-flush')

beforeEach(() => {
  vi.clearAllMocks()
  readPendingResultsMock.mockReturnValue([{ result: { gameId: 'queued' }, players: [] }])
})

describe('flushPendingResultsOnLaunch', () => {
  it('never touches Firebase when nothing is queued', async () => {
    readPendingResultsMock.mockReturnValue([])

    await flushPendingResultsOnLaunch()

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

    await flushPendingResultsOnLaunch()

    expect(ensureSignedInMock).toHaveBeenCalledWith('auth-instance')
    expect(writeGameResultMock).toHaveBeenCalledWith('db-instance', { gameId: 'g1' }, [])
  })

  // The forgery fix (docs/DECISIONS.md): firestore.rules' local-path game_player create rule
  // requires deviceUuid == request.auth.uid, so whatever LocalGameRepository queued offline must
  // be overwritten with the uid this device is ACTUALLY signed in as, right now.
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

    await flushPendingResultsOnLaunch()

    expect(writeGameResultMock).toHaveBeenCalledWith('db-instance', { gameId: 'g1' }, [
      { gameId: 'g1', deviceUuid: 'current-uid', displayName: 'Host', finalScore: 10 },
    ])
  })

  it('never throws when the flush itself rejects (still offline, or a write failed)', async () => {
    flushPendingResultsMock.mockRejectedValue(new Error('offline'))

    await expect(flushPendingResultsOnLaunch()).resolves.toBeUndefined()
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

    await expect(flushPendingResultsOnLaunch()).resolves.toBeUndefined()
  })
})
