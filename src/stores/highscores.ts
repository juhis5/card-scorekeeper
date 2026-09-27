/**
 * Global top-10 lists, read from the public `leaderboard` entries finished games publish. Loaded
 * apart from this device's stats, so a failure in one never hides the other.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { probeBackendReachable } from '@/lib/platform/connectivity'

/** Also the most firestore.rules lets one query read. */
export const HIGHSCORE_LIMIT = 10

export interface HighscoreEntry {
  id: string
  /** Shared by tied entries: 1, 1, 3. */
  rank: number
  displayName: string
  points: number
  finishedAt: string
  /** This device's own entry: its id ends with this device's uid. */
  isMine: boolean
}

export type HighscoreListName = 'bestGames' | 'worstGames' | 'biggestRounds'
export type HighscoresStatus = 'loading' | 'loaded' | 'error'

interface LeaderboardEntryData {
  displayName: string
  finalScore: number
  worstRound: number
  finishedAt: string
}

type RankedField = 'finalScore' | 'worstRound'

function toEntries(
  docs: { id: string; data: () => unknown }[],
  field: RankedField,
  uid: string,
): HighscoreEntry[] {
  const rows = docs.map((doc) => ({ id: doc.id, data: doc.data() as LeaderboardEntryData }))
  return rows.map(({ id, data }) => ({
    id,
    // The list is sorted, so the first entry with these points holds the shared rank.
    rank: rows.findIndex((row) => row.data[field] === data[field]) + 1,
    displayName: data.displayName,
    points: data[field],
    finishedAt: data.finishedAt,
    isMine: id.endsWith(`_${uid}`),
  }))
}

export const useHighscoresStore = defineStore('highscores', () => {
  const status = ref<HighscoresStatus>('loading')
  const lists = ref<Record<HighscoreListName, HighscoreEntry[]>>({
    bestGames: [],
    worstGames: [],
    biggestRounds: [],
  })

  /** Never throws: offline, a broken config or a refused read all land on `error`. */
  async function load(): Promise<void> {
    status.value = 'loading'
    try {
      const [
        { getDb, getFirebaseAuth, ensureSignedIn, checkBackendReachable },
        { collection, getDocs, limit, orderBy, query },
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
      const top = async (field: RankedField, direction: 'asc' | 'desc') => {
        const snapshot = await getDocs(
          query(collection(db, 'leaderboard'), orderBy(field, direction), limit(HIGHSCORE_LIMIT)),
        )
        return toEntries(snapshot.docs, field, uid)
      }
      const [bestGames, worstGames, biggestRounds] = await Promise.all([
        top('finalScore', 'asc'),
        top('finalScore', 'desc'),
        top('worstRound', 'desc'),
      ])
      lists.value = { bestGames, worstGames, biggestRounds }
      status.value = 'loaded'
    } catch {
      status.value = 'error'
    }
  }

  return { status, lists, load }
})
