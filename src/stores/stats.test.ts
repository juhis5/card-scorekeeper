import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { GamePlayer } from '@/lib/types'

const ensureSignedInMock = vi.fn()
const getDbMock = vi.fn(() => ({ marker: 'db' }))

vi.mock('@/lib/firebase', () => ({
  getDb: () => getDbMock(),
  getFirebaseAuth: () => ({}),
  ensureSignedIn: () => ensureSignedInMock(),
  checkBackendReachable: () => ensureSignedInMock(),
}))

/** A where() clause captured as data so the getDocs mock can dispatch on it (see below) — mirrors
 * firestore-stats.test.ts's "mock the boundary, inspect the shape" style rather than the real SDK. */
interface WhereClause {
  field: string
  op: string
  value: unknown
}

const whereMock = vi.fn((field: string, op: string, value: unknown): WhereClause => ({
  field,
  op,
  value,
}))
const collectionMock = vi.fn((_db: unknown, path: string) => ({ collectionPath: path }))
const queryMock = vi.fn((base: { collectionPath: string }, clause: WhereClause) => ({
  collectionPath: base.collectionPath,
  clause,
}))
const documentIdMock = vi.fn(() => '__name__')
const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (db: unknown, path: string) => collectionMock(db, path),
  query: (base: unknown, clause: unknown) =>
    queryMock(base as { collectionPath: string }, clause as WhereClause),
  where: (field: string, op: string, value: unknown) => whereMock(field, op, value),
  documentId: () => documentIdMock(),
  getDocs: (ref: unknown) => getDocsMock(ref),
}))

const { useStatsStore } = await import('./stats')

/** One fixture "database": every game_player row ever written, plus each game's finishedAt. The
 * getDocs mock below filters this in-memory, matching how the real queries would partition it. */
const ME = 'uid-me'
const BOB = 'uid-bob'

const ALL_ROWS: GamePlayer[] = [
  {
    gameId: 'g1',
    deviceUuid: ME,
    displayName: 'Me',
    finalScore: 40,
    placement: 1,
    bestRound: 5,
    worstRound: 20,
  },
  {
    gameId: 'g1',
    deviceUuid: BOB,
    displayName: 'Bob (game 1)',
    finalScore: 60,
    placement: 2,
    bestRound: 10,
    worstRound: 25,
  },
  {
    gameId: 'g2',
    deviceUuid: ME,
    displayName: 'Me',
    finalScore: 70,
    placement: 2,
    bestRound: 10,
    worstRound: 30,
  },
  {
    gameId: 'g2',
    deviceUuid: BOB,
    displayName: 'Bob (game 2)',
    finalScore: 50,
    placement: 1,
    bestRound: 8,
    worstRound: 22,
  },
  {
    // A solo local game with no opponent row at all — must still count toward this device's own
    // aggregate stats (see docs/DECISIONS.md's "Stats identity keying" entry).
    gameId: 'g3',
    deviceUuid: ME,
    displayName: 'Me',
    finalScore: 20,
    placement: 1,
    bestRound: 2,
    worstRound: 10,
  },
]

const ALL_RESULTS: Record<string, string> = {
  g1: '2026-01-01T00:00:00.000Z',
  g2: '2026-02-01T00:00:00.000Z', // later than g1 — "most recent" must pick this row's Bob name.
  g3: '2026-01-15T00:00:00.000Z',
}

function docsFor(rows: GamePlayer[]) {
  return { docs: rows.map((row) => ({ id: `${row.gameId}_${row.deviceUuid}`, data: () => row })) }
}

function resultDocsFor(gameIds: string[]) {
  return {
    docs: gameIds
      .filter((gameId) => gameId in ALL_RESULTS)
      .map((gameId) => ({ id: gameId, data: () => ({ finishedAt: ALL_RESULTS[gameId] }) })),
  }
}

/** Dispatches a mocked getDocs call by inspecting the fake query's collection path + where clause
 * — robust to call order/chunking, unlike a fixed mockResolvedValueOnce chain. */
function installFixtureGetDocs(rows: GamePlayer[] = ALL_ROWS): void {
  getDocsMock.mockImplementation(async (ref: { collectionPath: string; clause: WhereClause }) => {
    const { collectionPath, clause } = ref
    if (collectionPath === 'game_player' && clause.field === 'deviceUuid') {
      return docsFor(rows.filter((row) => row.deviceUuid === clause.value))
    }
    if (collectionPath === 'game_player' && clause.field === 'gameId') {
      const ids = clause.value as string[]
      return docsFor(rows.filter((row) => ids.includes(row.gameId)))
    }
    if (collectionPath === 'game_result') {
      return resultDocsFor(clause.value as string[])
    }
    throw new Error(`unexpected query: ${collectionPath} / ${clause.field}`)
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  getDbMock.mockReturnValue({ marker: 'db' })
})

// Unconditional, unlike an inline `vi.unstubAllGlobals()` at the end of a test body — a stubbed
// `navigator` must never survive a failing assertion into the next test (see the tdd skill's
// "test-order / shared state" flakiness guidance).
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useStatsStore.load — success', () => {
  it('starts in the loading status, then resolves to loaded', async () => {
    ensureSignedInMock.mockResolvedValue(ME)
    installFixtureGetDocs()
    const statsStore = useStatsStore()

    const pending = statsStore.load()
    expect(statsStore.status).toBe('loading')
    await pending

    expect(statsStore.status).toBe('loaded')
  })

  it('derives this device’s own stats across every game it played, solo or shared', async () => {
    ensureSignedInMock.mockResolvedValue(ME)
    installFixtureGetDocs()
    const statsStore = useStatsStore()

    await statsStore.load()

    expect(statsStore.stats).toEqual({
      deviceUuid: ME,
      gamesPlayed: 3,
      wins: 2, // placement 1 in g1 and g3
      winRate: 2 / 3,
      bestFinalScore: 20,
      worstFinalScore: 70,
      bestRound: 2,
      worstRound: 30,
      averageFinalScore: (40 + 70 + 20) / 3,
    })
  })

  it('derives a head-to-head record per opponent across only the games they share', async () => {
    ensureSignedInMock.mockResolvedValue(ME)
    installFixtureGetDocs()
    const statsStore = useStatsStore()

    await statsStore.load()

    expect(statsStore.opponents).toHaveLength(1)
    const bob = statsStore.opponents.at(0)
    // g1: me placement 1 < Bob placement 2 -> a win. g2: me placement 2 > Bob placement 1 -> a
    // loss. g3 has no Bob row, so it's excluded from gamesPlayed (2, not 3).
    expect(bob?.record).toEqual({
      deviceUuid: ME,
      opponentDeviceUuid: BOB,
      gamesPlayed: 2,
      wins: 1,
      losses: 1,
      ties: 0,
    })
  })

  it('picks the opponent’s displayName from their most recently finished shared game', async () => {
    ensureSignedInMock.mockResolvedValue(ME)
    installFixtureGetDocs()
    const statsStore = useStatsStore()

    await statsStore.load()

    // g2 (2026-02) finished after g1 (2026-01) — Bob's g2 name must win, not the last-seen row.
    expect(statsStore.opponents.at(0)?.displayName).toBe('Bob (game 2)')
  })

  it('chunks gameId queries so a device with more games than the `in`-clause limit still loads all of them', async () => {
    ensureSignedInMock.mockResolvedValue(ME)
    const manyGames: GamePlayer[] = Array.from({ length: 12 }, (_, index) => ({
      gameId: `many-${index}`,
      deviceUuid: ME,
      displayName: 'Me',
      finalScore: index,
      placement: 1,
      bestRound: 0,
      worstRound: index,
    }))
    installFixtureGetDocs(manyGames)
    const statsStore = useStatsStore()

    await statsStore.load()

    expect(statsStore.status).toBe('loaded')
    expect(statsStore.stats?.gamesPlayed).toBe(12)
    // Every `in` query (game_player-by-gameId and game_result) stayed within the chunk size.
    const inCalls = whereMock.mock.results
      .map((result) => result.value as WhereClause)
      .filter((clause) => clause.op === 'in')
    expect(inCalls.length).toBeGreaterThan(0)
    for (const call of inCalls) {
      expect((call.value as string[]).length).toBeLessThanOrEqual(10)
    }
  })
})

describe('useStatsStore.load — empty', () => {
  it('resolves to the empty status with zeroed stats when this device has no finished games', async () => {
    ensureSignedInMock.mockResolvedValue(ME)
    installFixtureGetDocs([])
    const statsStore = useStatsStore()

    await statsStore.load()

    expect(statsStore.status).toBe('empty')
    expect(statsStore.stats).toEqual({
      deviceUuid: ME,
      gamesPlayed: 0,
      wins: 0,
      winRate: 0,
      bestFinalScore: null,
      worstFinalScore: null,
      bestRound: null,
      worstRound: null,
      averageFinalScore: null,
    })
    expect(statsStore.opponents).toEqual([])
  })
})

describe('useStatsStore.load — error/offline degrade', () => {
  it('degrades to the error status, never throwing, when the device is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const statsStore = useStatsStore()

    await expect(statsStore.load()).resolves.toBeUndefined()

    expect(statsStore.status).toBe('error')
    expect(ensureSignedInMock).not.toHaveBeenCalled()
  })

  it('degrades to the error status when sign-in fails (e.g. a broken Firebase config)', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    ensureSignedInMock.mockRejectedValue(new Error('auth/invalid-api-key'))
    const statsStore = useStatsStore()

    await expect(statsStore.load()).resolves.toBeUndefined()

    expect(statsStore.status).toBe('error')
  })

  it('degrades to the error status when a read rejects after a successful sign-in', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    ensureSignedInMock.mockResolvedValue(ME)
    getDocsMock.mockRejectedValue(new Error('permission-denied'))
    const statsStore = useStatsStore()

    await expect(statsStore.load()).resolves.toBeUndefined()

    expect(statsStore.status).toBe('error')
  })

  it('lets a later retry succeed after a prior load failed', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const statsStore = useStatsStore()
    await statsStore.load()
    expect(statsStore.status).toBe('error')

    vi.stubGlobal('navigator', { onLine: true })
    ensureSignedInMock.mockResolvedValue(ME)
    installFixtureGetDocs()

    await statsStore.load()

    expect(statsStore.status).toBe('loaded')
  })
})
