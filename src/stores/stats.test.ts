import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { GamePlayer } from '@/lib/game/types'

const ensureSignedInMock = vi.fn()
const getDbMock = vi.fn(() => ({ marker: 'db' }))

vi.mock('@/lib/data/firebase', () => ({
  getDb: () => getDbMock(),
  getFirebaseAuth: () => ({}),
  ensureSignedIn: () => ensureSignedInMock(),
  checkBackendReachable: () => ensureSignedInMock(),
}))

/** A where() clause captured as data, so the getDocs mock can dispatch on it. */
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
interface FakeQuery {
  collectionPath: string
  clauses: WhereClause[]
}
const queryMock = vi.fn(
  (base: { collectionPath: string }, ...clauses: WhereClause[]): FakeQuery => ({
    collectionPath: base.collectionPath,
    clauses,
  }),
)
const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (db: unknown, path: string) => collectionMock(db, path),
  query: (base: unknown, ...clauses: unknown[]) =>
    queryMock(base as { collectionPath: string }, ...(clauses as WhereClause[])),
  where: (field: string, op: string, value: unknown) => whereMock(field, op, value),
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
    // A solo game with no opponent row still counts toward this device's own stats.
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
  g2: '2026-02-01T00:00:00.000Z', // after g1, so "most recent" picks this Bob name
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

function clauseOn(query: FakeQuery, field: string): WhereClause | undefined {
  return query.clauses.find((clause) => clause.field === field)
}

/** Answers getDocs from the fake query's collection and where clauses, whatever the call order. */
function installFixtureGetDocs(rows: GamePlayer[] = ALL_ROWS): void {
  getDocsMock.mockImplementation(async (query: FakeQuery) => {
    const byDevice = clauseOn(query, 'deviceUuid')
    const byGame = clauseOn(query, 'gameId')
    const byParticipant = clauseOn(query, 'participantUids')
    if (query.collectionPath === 'game_player' && byDevice) {
      return docsFor(rows.filter((row) => row.deviceUuid === byDevice.value))
    }
    if (query.collectionPath === 'game_player' && byGame) {
      const ids = byGame.value as string[]
      return docsFor(rows.filter((row) => ids.includes(row.gameId)))
    }
    if (query.collectionPath === 'game_result' && byParticipant && query.clauses.length === 1) {
      const playedGameIds = rows
        .filter((row) => row.deviceUuid === byParticipant.value)
        .map((row) => row.gameId)
      return resultDocsFor(playedGameIds)
    }
    throw new Error(`unexpected query: ${JSON.stringify(query)}`)
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  getDbMock.mockReturnValue({ marker: 'db' })
})

// In afterEach, so a failing assertion can't leave `navigator` stubbed.
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
    // g1 a win, g2 a loss; g3 has no Bob row, so it doesn't count.
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

    // g2 finished after g1, so Bob's g2 name wins.
    expect(statsStore.opponents.at(0)?.displayName).toBe('Bob (game 2)')
  })

  it('loads game results by participant, never by document id', async () => {
    // Production Firestore refuses `documentId() in [...]` combined with the participant filter
    // (permission-denied), although the emulator allows it.
    ensureSignedInMock.mockResolvedValue(ME)
    installFixtureGetDocs()
    const statsStore = useStatsStore()

    await statsStore.load()

    expect(statsStore.status).toBe('loaded')
    const clauses = whereMock.mock.results.map((result) => result.value as WhereClause)
    expect(clauses.some((clause) => clause.field === '__name__')).toBe(false)
    expect(queryMock).toHaveBeenCalledWith(
      { collectionPath: 'game_result' },
      { field: 'participantUids', op: 'array-contains', value: ME },
    )
  })

  it('chunks gameId queries so a device with more games than the `in`-clause limit still loads all of them', async () => {
    ensureSignedInMock.mockResolvedValue(ME)
    const manyGames: GamePlayer[] = Array.from({ length: 35 }, (_, index) => ({
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
    expect(statsStore.stats?.gamesPlayed).toBe(35)
    // Two game_player-by-gameId queries, each within Firestore's 30-value `in` limit.
    const inCalls = whereMock.mock.results
      .map((result) => result.value as WhereClause)
      .filter((clause) => clause.op === 'in')
    expect(inCalls).toHaveLength(2)
    for (const call of inCalls) {
      expect((call.value as string[]).length).toBeLessThanOrEqual(30)
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
