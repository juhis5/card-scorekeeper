import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GamePlayer, GameResult } from '../game/types'

const setDocMock = vi.fn().mockResolvedValue(undefined)
const getDocMock = vi.fn()
const docMock = vi.fn((db: unknown, path: string) => ({ db, path }))

/** A transaction whose reads use getDocMock and whose writes are recorded like setDoc's. */
const transactionSetMock = vi.fn()
const runTransactionMock = vi.fn(
  async (_db: unknown, update: (transaction: unknown) => Promise<void>) => {
    await update({
      get: (ref: unknown) => getDocMock(ref),
      set: (ref: unknown, data: unknown) => transactionSetMock(ref, data),
    })
  },
)

vi.mock('firebase/firestore', () => ({
  doc: (db: unknown, path: string) => docMock(db, path),
  getDoc: (ref: unknown) => getDocMock(ref),
  setDoc: (ref: unknown, data: unknown) => setDocMock(ref, data),
  runTransaction: (db: unknown, update: (transaction: unknown) => Promise<void>) =>
    runTransactionMock(db, update),
}))

const { publishHighscores, writeGameResult } = await import('./firestore-stats')

const DB = {} as never

const RESULT: GameResult = {
  gameId: 'g1',
  finishedAt: '2026-01-01T00:00:00.000Z',
  totalRounds: 5,
}

const PLAYERS: GamePlayer[] = [
  {
    gameId: 'g1',
    deviceUuid: 'device-a',
    displayName: 'Alice',
    finalScore: 10,
    placement: 1,
    bestRound: 0,
    worstRound: 5,
  },
  {
    gameId: 'g1',
    deviceUuid: 'device-b',
    displayName: 'Bob',
    finalScore: 20,
    placement: 2,
    bestRound: 2,
    worstRound: 8,
  },
]

function pathOf(ref: unknown): string {
  return (ref as { path: string }).path
}

beforeEach(() => {
  vi.clearAllMocks()
  setDocMock.mockResolvedValue(undefined)
  getDocMock.mockResolvedValue({ exists: () => false })
})

describe('writeGameResult', () => {
  it('writes the game_result doc keyed by gameId, naming every player as a participant', async () => {
    await writeGameResult(DB, RESULT, PLAYERS)

    expect(docMock).toHaveBeenCalledWith(DB, 'game_result/g1')
    expect(setDocMock).toHaveBeenCalledWith(
      { db: DB, path: 'game_result/g1' },
      {
        gameId: 'g1',
        finishedAt: '2026-01-01T00:00:00.000Z',
        totalRounds: 5,
        participantUids: ['device-a', 'device-b'],
      },
    )
  })

  it('writes one game_player doc per player, keyed by {gameId}_{deviceUuid}', async () => {
    await writeGameResult(DB, RESULT, PLAYERS)

    expect(docMock).toHaveBeenCalledWith(DB, 'game_player/g1_device-a')
    expect(docMock).toHaveBeenCalledWith(DB, 'game_player/g1_device-b')
    expect(setDocMock).toHaveBeenCalledWith(
      { db: DB, path: 'game_player/g1_device-a' },
      {
        gameId: 'g1',
        participantUids: ['device-a', 'device-b'],
        deviceUuid: 'device-a',
        displayName: 'Alice',
        finalScore: 10,
        placement: 1,
        bestRound: 0,
        worstRound: 5,
      },
    )
  })

  it('writes the game_result doc before any game_player doc (sequential, not batched)', async () => {
    await writeGameResult(DB, RESULT, PLAYERS)

    const paths = setDocMock.mock.calls.map((call) => pathOf(call[0]))
    const resultIndex = paths.indexOf('game_result/g1')
    const playerIndices = paths
      .map((path, index) => ({ path, index }))
      .filter((entry) => entry.path.startsWith('game_player/'))
      .map((entry) => entry.index)

    expect(resultIndex).toBe(0)
    expect(Math.min(...playerIndices)).toBeGreaterThan(resultIndex)
  })

  it('writes no highscore entries: those wait until the room is finished, and local games never get one', async () => {
    await writeGameResult(DB, RESULT, PLAYERS)

    expect(runTransactionMock).not.toHaveBeenCalled()
  })

  it('writes nothing beyond the game_result doc when there are no players', async () => {
    await writeGameResult(DB, RESULT, [])

    expect(setDocMock).toHaveBeenCalledTimes(1)
  })

  it('skips re-creating the game_result doc when it already exists (idempotent retry)', async () => {
    getDocMock.mockImplementation((ref: unknown) =>
      Promise.resolve({ exists: () => pathOf(ref) === 'game_result/g1' }),
    )

    await writeGameResult(DB, RESULT, PLAYERS)

    const paths = setDocMock.mock.calls.map((call) => pathOf(call[0]))
    expect(paths).not.toContain('game_result/g1')
    // The game_player docs didn't exist yet, so they're still written.
    expect(paths).toEqual(
      expect.arrayContaining(['game_player/g1_device-a', 'game_player/g1_device-b']),
    )
  })

  it('skips re-creating a game_player row that already exists, still writing the others', async () => {
    getDocMock.mockImplementation((ref: unknown) =>
      Promise.resolve({ exists: () => pathOf(ref) === 'game_player/g1_device-a' }),
    )

    await writeGameResult(DB, RESULT, PLAYERS)

    const paths = setDocMock.mock.calls.map((call) => pathOf(call[0]))
    expect(paths).toContain('game_result/g1')
    expect(paths).not.toContain('game_player/g1_device-a')
    expect(paths).toContain('game_player/g1_device-b')
  })

  it('writes nothing at all when every doc already exists (a fully-succeeded retry is a no-op)', async () => {
    getDocMock.mockResolvedValue({ exists: () => true })

    await writeGameResult(DB, RESULT, PLAYERS)

    expect(setDocMock).not.toHaveBeenCalled()
  })
})

describe('publishHighscores', () => {
  it("publishes each player's highscore entry with their new totals", async () => {
    await publishHighscores(DB, RESULT, PLAYERS)

    const written = transactionSetMock.mock.calls.map(([ref, data]) => [pathOf(ref), data])
    expect(written).toContainEqual([
      'leaderboard/g1_device-b',
      { displayName: 'Bob', finalScore: 20, worstRound: 8, finishedAt: '2026-01-01T00:00:00.000Z' },
    ])
    expect(written).toContainEqual([
      'player_totals/device-b',
      expect.objectContaining({ gamesPlayed: 1, wins: 0, scoreSum: 20, lastEntry: 'g1_device-b' }),
    ])
    expect(runTransactionMock).toHaveBeenCalledTimes(2)
  })

  it("adds to a player's existing totals, and counts a game already published only once", async () => {
    getDocMock.mockImplementation((ref: unknown) => {
      const path = pathOf(ref)
      if (path === 'player_totals/device-a') {
        return Promise.resolve({
          exists: () => true,
          data: () => ({ gamesPlayed: 4, wins: 2, scoreSum: 200 }),
        })
      }
      return Promise.resolve({ exists: () => path === 'leaderboard/g1_device-b' })
    })

    await publishHighscores(DB, RESULT, PLAYERS)

    const written = transactionSetMock.mock.calls.map(([ref, data]) => [pathOf(ref), data])
    expect(written).toContainEqual([
      'player_totals/device-a',
      expect.objectContaining({ gamesPlayed: 5, wins: 3, scoreSum: 210, qualified: true }),
    ])
    expect(written.map(([path]) => path)).not.toContain('player_totals/device-b')
  })

  it('never fails when the highscores refuse an entry', async () => {
    runTransactionMock.mockRejectedValueOnce(new Error('permission-denied'))

    await expect(publishHighscores(DB, RESULT, PLAYERS)).resolves.toBeUndefined()
  })
})
