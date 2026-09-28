/**
 * Global top-10 lists: game records from the public `leaderboard` entries, and player lists from
 * each player's running totals (`player_totals`), both published when a game finishes. Loaded
 * apart from this device's stats, so a failure in one never hides the other.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { probeBackendReachable } from '@/lib/platform/connectivity'
import { reportHandledError } from '@/lib/platform/error-reporting'

/** Also the most firestore.rules lets one query read. */
export const HIGHSCORE_LIMIT = 10

export interface HighscoreEntry {
  id: string
  /** Shared by tied entries: 1, 1, 3. */
  rank: number
  displayName: string
  value: number
  /** Game records: when the game finished. */
  finishedAt?: string
  /** Player lists: how many games the total covers. */
  gamesPlayed?: number
  /** This device's own entry or totals. */
  isMine: boolean
}

export type HighscoreListName =
  | 'bestGames'
  | 'worstGames'
  | 'biggestRounds'
  | 'mostWins'
  | 'bestWinRate'
  | 'bestAverage'
  | 'mostGames'
export type HighscoresStatus = 'loading' | 'loaded' | 'error'

interface ListQuery {
  collection: 'leaderboard' | 'player_totals'
  field: string
  direction: 'asc' | 'desc'
  /** Win rate and average rank only players with enough games. */
  qualifiedOnly?: boolean
}

const LISTS: Record<HighscoreListName, ListQuery> = {
  bestGames: { collection: 'leaderboard', field: 'finalScore', direction: 'asc' },
  worstGames: { collection: 'leaderboard', field: 'finalScore', direction: 'desc' },
  biggestRounds: { collection: 'leaderboard', field: 'worstRound', direction: 'desc' },
  mostWins: { collection: 'player_totals', field: 'wins', direction: 'desc' },
  bestWinRate: {
    collection: 'player_totals',
    field: 'winRate',
    direction: 'desc',
    qualifiedOnly: true,
  },
  bestAverage: {
    collection: 'player_totals',
    field: 'averageScore',
    direction: 'asc',
    qualifiedOnly: true,
  },
  mostGames: { collection: 'player_totals', field: 'gamesPlayed', direction: 'desc' },
}

type Document = { id: string; data: () => Record<string, unknown> }

/** Entries are public and older ones predate the rules' format check: an unreadable date is left
 * out, since formatting it would throw and blank the whole list. */
function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function toEntries(docs: Document[], list: ListQuery, uid: string): HighscoreEntry[] {
  const rows = docs.map((doc) => ({ id: doc.id, data: doc.data() }))
  return rows.map(({ id, data }) => ({
    id,
    // The list is sorted, so the first entry with this value holds the shared rank.
    rank: rows.findIndex((row) => row.data[list.field] === data[list.field]) + 1,
    displayName: String(data.displayName),
    value: Number(data[list.field]),
    ...(isValidDate(data.finishedAt) && { finishedAt: data.finishedAt }),
    ...(typeof data.gamesPlayed === 'number' && { gamesPlayed: data.gamesPlayed }),
    // A leaderboard entry is `{game}_{player}`; a totals doc is the player's own id.
    isMine: list.collection === 'player_totals' ? id === uid : id.endsWith(`_${uid}`),
  }))
}

function emptyLists(): Record<HighscoreListName, HighscoreEntry[]> {
  return {
    bestGames: [],
    worstGames: [],
    biggestRounds: [],
    mostWins: [],
    bestWinRate: [],
    bestAverage: [],
    mostGames: [],
  }
}

export const useHighscoresStore = defineStore('highscores', () => {
  const status = ref<HighscoresStatus>('loading')
  const lists = ref(emptyLists())

  /** Never throws: offline, a broken config or a refused read all land on `error`. */
  async function load(): Promise<void> {
    status.value = 'loading'
    try {
      const [
        { getDb, getFirebaseAuth, ensureSignedIn, checkBackendReachable },
        { collection, getDocs, limit, orderBy, query, where },
      ] = await Promise.all([import('@/lib/data/firebase'), import('firebase/firestore')])
      const db = getDb()
      const reachable = await probeBackendReachable({
        checkBackend: () => checkBackendReachable(getFirebaseAuth(), db),
      })
      if (!reachable) {
        status.value = 'error'
        return
      }
      const uid = await ensureSignedIn()
      const top = async ([name, list]: [HighscoreListName, ListQuery]) => {
        const snapshot = await getDocs(
          query(
            collection(db, list.collection),
            ...(list.qualifiedOnly ? [where('qualified', '==', true)] : []),
            orderBy(list.field, list.direction),
            limit(HIGHSCORE_LIMIT),
          ),
        )
        return [name, toEntries(snapshot.docs as Document[], list, uid)] as const
      }
      const loaded = await Promise.all(
        (Object.entries(LISTS) as [HighscoreListName, ListQuery][]).map(top),
      )
      lists.value = { ...emptyLists(), ...Object.fromEntries(loaded) }
      status.value = 'loaded'
    } catch (error) {
      reportHandledError(error, 'load-highscores')
      status.value = 'error'
    }
  }

  return { status, lists, load }
})
