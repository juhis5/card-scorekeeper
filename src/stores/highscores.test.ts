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
  field: string
  direction: string
  count: number
}

const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  orderBy: (field: string, direction: string) => ({ field, direction }),
  limit: (count: number) => ({ count }),
  query: (
    base: { path: string },
    order: { field: string; direction: string },
    top: { count: number },
  ) => ({ path: base.path, ...order, ...top }) satisfies FakeQuery,
  getDocs: (ref: unknown) => getDocsMock(ref),
}))

const { useHighscoresStore } = await import('./highscores')

const ME = 'uid-me'

const ENTRIES = [
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
]

/** Sorts the fixture the way the query asks, like Firestore would. */
function installBoard(): void {
  getDocsMock.mockImplementation(async (query: FakeQuery) => {
    const field = query.field as 'finalScore' | 'worstRound'
    const sorted = [...ENTRIES].sort((a, b) =>
      query.direction === 'asc' ? a[field] - b[field] : b[field] - a[field],
    )
    return {
      docs: sorted.slice(0, query.count).map(({ id, ...data }) => ({ id, data: () => data })),
    }
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  ensureSignedInMock.mockResolvedValue(ME)
})

describe('useHighscoresStore', () => {
  it('loads the best games, the hall of shame and the biggest rounds, ten each at most', async () => {
    installBoard()
    const highscores = useHighscoresStore()

    await highscores.load()

    expect(highscores.status).toBe('loaded')
    expect(highscores.lists.bestGames.map((entry) => entry.points)).toEqual([45, 45, 300])
    expect(highscores.lists.worstGames.map((entry) => entry.displayName)[0]).toBe('Mummo')
    expect(highscores.lists.biggestRounds.map((entry) => entry.points)).toEqual([210, 60, 25])
    expect(getDocsMock.mock.calls.map(([query]) => (query as FakeQuery).count)).toEqual([
      10, 10, 10,
    ])
  })

  it("ranks ties together and marks this device's own entries", async () => {
    installBoard()
    const highscores = useHighscoresStore()

    await highscores.load()

    expect(highscores.lists.bestGames.map((entry) => entry.rank)).toEqual([1, 1, 3])
    expect(highscores.lists.bestGames.map((entry) => entry.isMine)).toEqual([true, false, false])
  })

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
