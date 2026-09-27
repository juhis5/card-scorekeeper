import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { render, screen, fireEvent } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import StatsView from './StatsView.vue'
import { i18n } from '@/i18n'
import type { GamePlayer } from '@/lib/types'

/**
 * StatsView delegates all Firestore I/O to `useStatsStore` (see stores/stats.test.ts for the
 * store's own thorough coverage of the read/derivation logic) — this file only proves the view
 * renders the right thing for each of the store's four states, so it mocks at the same
 * Firebase/Firestore boundary the store itself uses (see the tdd skill's "mock at the boundary"),
 * rather than re-deriving expected numbers here.
 */
const ensureSignedInMock = vi.fn()
const getDbMock = vi.fn(() => ({}))

vi.mock('@/lib/firebase', () => ({
  getDb: () => getDbMock(),
  getFirebaseAuth: () => ({}),
  ensureSignedIn: () => ensureSignedInMock(),
  checkBackendReachable: () => ensureSignedInMock(),
}))

interface WhereClause {
  field: string
  op: string
  value: unknown
}

interface FakeQuery {
  collectionPath: string
  clauses: WhereClause[]
}

const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ collectionPath: path }),
  query: (base: { collectionPath: string }, ...clauses: WhereClause[]): FakeQuery => ({
    collectionPath: base.collectionPath,
    clauses,
  }),
  where: (field: string, op: string, value: unknown): WhereClause => ({ field, op, value }),
  getDocs: (ref: unknown) => getDocsMock(ref),
}))

const ME = 'uid-me'
const BOB = 'uid-bob'

const ROWS: GamePlayer[] = [
  {
    gameId: 'g1',
    deviceUuid: ME,
    displayName: 'Me',
    finalScore: 30,
    placement: 1,
    bestRound: 5,
    worstRound: 15,
  },
  {
    gameId: 'g1',
    deviceUuid: BOB,
    displayName: 'Bob',
    finalScore: 50,
    placement: 2,
    bestRound: 10,
    worstRound: 20,
  },
]

function docsFor(rows: GamePlayer[]) {
  return { docs: rows.map((row) => ({ id: `${row.gameId}_${row.deviceUuid}`, data: () => row })) }
}

function installFixtureGetDocs(rows: GamePlayer[]): void {
  getDocsMock.mockImplementation(async ({ collectionPath, clauses }: FakeQuery) => {
    const [clause] = clauses
    if (collectionPath === 'game_player' && clause?.field === 'deviceUuid') {
      return docsFor(rows.filter((row) => row.deviceUuid === clause.value))
    }
    if (collectionPath === 'game_player' && clause?.field === 'gameId') {
      const ids = clause.value as string[]
      return docsFor(rows.filter((row) => ids.includes(row.gameId)))
    }
    if (collectionPath === 'game_result' && clause?.field === 'participantUids') {
      const gameIds = rows.filter((row) => row.deviceUuid === clause.value).map((row) => row.gameId)
      return {
        docs: gameIds.map((gameId) => ({
          id: gameId,
          data: () => ({ finishedAt: '2026-01-01T00:00:00.000Z' }),
        })),
      }
    }
    throw new Error(`unexpected query: ${collectionPath}`)
  })
}

/** A promise you can resolve from outside — observes the loading state mid-flight without a real
 * network delay (see GameSetup.test.ts's identical helper). */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function renderStatsView() {
  return render(StatsView, { global: { plugins: [i18n] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  getDbMock.mockReturnValue({})
})

// Unconditional (not an inline call at the end of each test body) so a stubbed `navigator` can
// never survive a failing assertion into the next test (see the tdd skill's flakiness guidance).
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('StatsView', () => {
  it('always states the identity caveats, regardless of load state', () => {
    ensureSignedInMock.mockReturnValue(new Promise(() => {})) // never resolves — stays loading
    renderStatsView()

    expect(screen.getByText(/new device or cleared browser storage starts fresh/i)).toBeTruthy()
  })

  it('shows a loading status while the store is fetching', async () => {
    const { promise } = deferred<string>()
    ensureSignedInMock.mockReturnValue(promise)
    renderStatsView()
    await flushPromises()

    expect(screen.getByRole('status').textContent).toContain('Loading your stats…')
  })

  it('renders the summary + head-to-head list once stats load successfully', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    ensureSignedInMock.mockResolvedValue(ME)
    installFixtureGetDocs(ROWS)
    renderStatsView()

    await flushPromises()

    expect(screen.getByText('Summary')).toBeTruthy()
    expect(screen.getByText('Games played')).toBeTruthy()
    expect(screen.getByText('Head-to-head')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  it('shows a friendly empty message when this device has no finished games', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    ensureSignedInMock.mockResolvedValue(ME)
    installFixtureGetDocs([])
    renderStatsView()

    await flushPromises()

    expect(screen.getByText('No finished games yet — play a game!')).toBeTruthy()
  })

  it('shows an error message with a retry action when the device is offline, and retry can recover', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    renderStatsView()
    await flushPromises()

    expect(screen.getByRole('alert').textContent).toContain("Couldn't load your stats")
    const retryButton = screen.getByRole('button', { name: 'Retry' })

    vi.stubGlobal('navigator', { onLine: true })
    ensureSignedInMock.mockResolvedValue(ME)
    installFixtureGetDocs(ROWS)
    await fireEvent.click(retryButton)
    await flushPromises()

    expect(screen.getByText('Summary')).toBeTruthy()
  })
})
