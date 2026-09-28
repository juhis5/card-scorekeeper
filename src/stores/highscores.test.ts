import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const ensureSignedInMock = vi.fn()

vi.mock('@/lib/data/firebase', () => ({
  getDb: () => ({}),
  getFirebaseAuth: () => ({}),
  ensureSignedIn: () => ensureSignedInMock(),
  checkBackendReachable: () => ensureSignedInMock(),
}))

interface FakeQuery {
  path: string
  field?: string
  direction?: string
  count?: number
  where?: [string, string, unknown]
}

const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  orderBy: (field: string, direction: string) => ({ field, direction }),
  limit: (count: number) => ({ count }),
  query: (base: { path: string }, ...parts: object[]): FakeQuery =>
    Object.assign({}, base, ...parts),
  getDocs: (ref: unknown) => getDocsMock(ref),
}))

const { useHighscoresStore } = await import('./highscores')

const ME = 'uid-me'

const COLLECTIONS: Record<string, { id: string; [field: string]: unknown }[]> = {
  leaderboard: [
    {
      id: `ABCDE_${ME}`,
      displayName: 'Juho',
      finalScore: 45,
      worstRound: 25,
      finishedAt: '2026-09-14T18:00:00.000Z',
    },
    {
      id: 'ABCDE_uid-ripa',
      displayName: 'Ripa',
      finalScore: 45,
      worstRound: 60,
      finishedAt: '2026-09-14T18:00:00.000Z',
    },
    {
      id: 'FGHJK_guest-1',
      displayName: 'Mummo',
      finalScore: 300,
      worstRound: 210,
      finishedAt: '2026-09-21T18:00:00.000Z',
    },
  ],
  player_totals: [
    {
      id: ME,
      displayName: 'Juho',
      gamesPlayed: 6,
      wins: 3,
      scoreSum: 600,
      winRate: 0.5,
      averageScore: 100,
      qualified: true,
    },
    {
      id: 'uid-ripa',
      displayName: 'Ripa',
      gamesPlayed: 12,
      wins: 5,
      scoreSum: 1440,
      winRate: 5 / 12,
      averageScore: 120,
      qualified: true,
    },
    {
      id: 'guest-1',
      displayName: 'Mummo',
      gamesPlayed: 2,
      wins: 2,
      scoreSum: 90,
      winRate: 1,
      averageScore: 45,
      qualified: false,
    },
  ],
}

/** Filters and sorts the fixture the way the query asks, like Firestore would. */
function installBoard(): void {
  getDocsMock.mockImplementation(async (query: FakeQuery) => {
    const field = query.field ?? ''
    const rows = (COLLECTIONS[query.path] ?? [])
      .filter((row) => !query.where || row[query.where[0]] === query.where[2])
      .sort((a, b) => {
        const [x, y] = [Number(a[field]), Number(b[field])]
        return query.direction === 'asc' ? x - y : y - x
      })
    return {
      docs: rows.slice(0, query.count).map(({ id, ...data }) => ({ id, data: () => data })),
    }
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  ensureSignedInMock.mockResolvedValue(ME)
})

describe('useHighscoresStore, game records', () => {
  it('loads the best games, the hall of shame and the biggest rounds', async () => {
    installBoard()
    const highscores = useHighscoresStore()

    await highscores.load()

    expect(highscores.status).toBe('loaded')
    expect(highscores.lists.bestGames.map((entry) => entry.value)).toEqual([45, 45, 300])
    expect(highscores.lists.worstGames[0]?.displayName).toBe('Mummo')
    expect(highscores.lists.biggestRounds.map((entry) => entry.value)).toEqual([210, 60, 25])
  })

  it("ranks ties together and marks this device's own entries", async () => {
    installBoard()
    const highscores = useHighscoresStore()

    await highscores.load()

    expect(highscores.lists.bestGames.map((entry) => entry.rank)).toEqual([1, 1, 3])
    expect(highscores.lists.bestGames.map((entry) => entry.isMine)).toEqual([true, false, false])
  })
})

describe('useHighscoresStore, player lists', () => {
  it('ranks players by wins and by games played, and marks this device', async () => {
    installBoard()
    const highscores = useHighscoresStore()

    await highscores.load()

    expect(highscores.lists.mostWins.map((entry) => entry.displayName)).toEqual([
      'Ripa',
      'Juho',
      'Mummo',
    ])
    expect(highscores.lists.mostGames.map((entry) => entry.value)).toEqual([12, 6, 2])
    expect(highscores.lists.mostWins.find((entry) => entry.isMine)?.displayName).toBe('Juho')
  })

  it('ranks win rate and average only among players with enough games', async () => {
    installBoard()
    const highscores = useHighscoresStore()

    await highscores.load()

    expect(highscores.lists.bestWinRate.map((entry) => entry.displayName)).toEqual(['Juho', 'Ripa'])
    expect(highscores.lists.bestAverage.map((entry) => entry.value)).toEqual([100, 120])
    expect(highscores.lists.bestAverage[0]?.gamesPlayed).toBe(6)
  })

  it('leaves out an unreadable date instead of letting it break the list', async () => {
    const original = COLLECTIONS.leaderboard?.[2]?.finishedAt
    const forged = COLLECTIONS.leaderboard?.[2]
    if (!forged) throw new Error('expected a third leaderboard entry')
    forged.finishedAt = 'x'
    try {
      installBoard()
      const store = useHighscoresStore()

      await store.load()

      const mummo = store.lists.bestGames.find((entry) => entry.displayName === 'Mummo')
      expect(mummo).toBeDefined()
      expect(mummo?.finishedAt).toBeUndefined()
    } finally {
      forged.finishedAt = original
    }
  })

  it('reads every list ten at a time at most', async () => {
    installBoard()

    await useHighscoresStore().load()

    expect(getDocsMock.mock.calls.map(([query]) => (query as FakeQuery).count)).toEqual(
      Array(7).fill(10),
    )
  })
})

describe('useHighscoresStore, failures', () => {
  it('says so when the board cannot be read, and a retry can succeed', async () => {
    getDocsMock.mockRejectedValueOnce(new Error('unavailable'))
    const highscores = useHighscoresStore()

    await highscores.load()
    expect(highscores.status).toBe('error')

    installBoard()
    await highscores.load()
    expect(highscores.status).toBe('loaded')
  })
})
