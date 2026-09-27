/**
 * Read-side stats store (the Stats screen; see docs/PLAN.md "Stats & history"). Loads this
 * device's `game_player` rows from Firestore and derives its stats + head-to-head records via
 * the pure `lib/stats.ts` functions — this store owns I/O only, never the math (see the
 * clean-code/vue-pinia skills: dependencies point inward, `lib/` stays framework/network-free).
 *
 * Identity: the stats key is the Firebase Anonymous Auth **uid**, not the separate localStorage
 * `device_uuid` the identity store holds (see docs/DECISIONS.md's 2026-07-24 "Stats rows key on
 * the anon UID" entry). `ensureSignedIn()` (from `lib/firebase.ts`) resolves it.
 *
 * Read strategy — kept lean, two passes, never "read the whole `game_player` collection" (which
 * only grows, across every room anyone has ever played):
 *   1. This device's OWN rows (`where('deviceUuid', '==', uid)`) — cheap, and enough to answer
 *      "does this device have any finished games at all" (the empty state) and to learn which
 *      `gameId`s to look at next.
 *   2. Every OTHER row from those same games (`where('gameId', 'in', <chunk>)`, chunked to stay
 *      under Firestore's `in`-clause limit) — this is what gives head-to-head its opponents. The
 *      matching `game_result` docs (`documentId() in <chunk>`) are fetched alongside for their
 *      `finishedAt`, the only way to pick the "most recent" `displayName` per opponent uid
 *      (`game_player` itself carries no timestamp). Both stay bounded by "games THIS device
 *      played", never the whole collection — the one accepted inefficiency is that step 2
 *      re-reads this device's own rows too (querying by `gameId` returns every participant); for
 *      a hobby-scale game count that's still tiny, and avoiding it would need a compound filter
 *      Firestore doesn't offer cleanly.
 *
 * Graceful degrade (mirrors `useGameConnectivity`): Firebase/Firestore load via a dynamic
 * `import()` so visiting the Stats screen never taxes the initial bundle, and
 * `probeBackendReachable` (the same reachability probe `useGameConnectivity` uses, checking
 * `checkBackendReachable` with a bounded timeout) gates the read — offline, a broken `VITE_FIREBASE_*`
 * config, or any failure along the way lands on the `error` status, never a throw/crash.
 * error-ux's four states have no separate "offline" bucket, so `error` covers both here; the
 * view's retry action is just calling `load()` again.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { probeBackendReachable } from '@/lib/connectivity'
import { headToHead, playerStats } from '@/lib/stats'
import type { HeadToHeadRecord, PlayerStats } from '@/lib/stats'
import type { GamePlayer, GameResult } from '@/lib/types'

/** Firestore's `in` operator caps how many values one query can compare against. The documented
 * ceiling has moved over time (10, then 30) — chunk well under either rather than assume the
 * current one. */
const IN_QUERY_CHUNK_SIZE = 10

export type StatsStatus = 'loading' | 'loaded' | 'empty' | 'error'

export interface OpponentRecord {
  opponentDeviceUuid: string
  /** The displayName from the OPPONENT's most recently finished shared game (see the file doc
   * comment on why "most recent" needs `game_result.finishedAt`, not a field on `GamePlayer`). */
  displayName: string
  record: HeadToHeadRecord
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

/**
 * The opponent's displayName from whichever of `rows` belongs to the most recently finished game,
 * per `finishedAtByGameId` (ISO strings sort correctly as plain strings). Falls back to the last
 * row seen if none of them have a resolvable `finishedAt` — should not happen (every `game_player`
 * row's `game_result` is required to exist by firestore.rules's create rule) but keeps this total
 * rather than throwing on a row this module didn't expect.
 */
function mostRecentDisplayName(
  rows: readonly GamePlayer[],
  finishedAtByGameId: ReadonlyMap<string, string>,
): string {
  // `reduce` with no seed operates directly on elements (never an out-of-bounds index), so this
  // needs no non-null assertion even under `noUncheckedIndexedAccess` — unlike `rows[0]`.
  return rows.reduce((best, row) => {
    const bestFinishedAt = finishedAtByGameId.get(best.gameId) ?? ''
    const finishedAt = finishedAtByGameId.get(row.gameId) ?? ''
    return finishedAt >= bestFinishedAt ? row : best
  }).displayName
}

/** Groups every non-own row by opponent uid and derives each opponent's displayName + head-to-head
 * record. `rows` is the FULL loaded set (own + opponents') — `headToHead` filters internally. */
function buildOpponentRecords(
  uid: string,
  rows: GamePlayer[],
  finishedAtByGameId: ReadonlyMap<string, string>,
): OpponentRecord[] {
  const rowsByOpponent = new Map<string, GamePlayer[]>()
  for (const row of rows) {
    if (row.deviceUuid === uid) continue
    const forOpponent = rowsByOpponent.get(row.deviceUuid) ?? []
    forOpponent.push(row)
    rowsByOpponent.set(row.deviceUuid, forOpponent)
  }

  return [...rowsByOpponent.entries()]
    .map(([opponentDeviceUuid, opponentRows]) => ({
      opponentDeviceUuid,
      displayName: mostRecentDisplayName(opponentRows, finishedAtByGameId),
      record: headToHead(uid, opponentDeviceUuid, rows),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export const useStatsStore = defineStore('stats', () => {
  const status = ref<StatsStatus>('loading')
  const stats = ref<PlayerStats | null>(null)
  const opponents = ref<OpponentRecord[]>([])

  /** Loads (or reloads) this device's stats. Never throws — every failure mode, including a
   * broken/absent Firebase config, an offline device, or a rejected read, lands on `error`. */
  async function load(): Promise<void> {
    status.value = 'loading'
    try {
      const [
        { getDb, getFirebaseAuth, ensureSignedIn, checkBackendReachable },
        { collection, query, where, getDocs, documentId },
      ] = await Promise.all([import('@/lib/firebase'), import('firebase/firestore')])

      const db = getDb()
      const reachable = await probeBackendReachable({
        checkBackend: () => checkBackendReachable(getFirebaseAuth(), db),
      })
      if (!reachable) {
        status.value = 'error'
        return
      }

      const uid = await ensureSignedIn()

      const ownSnapshot = await getDocs(
        query(collection(db, 'game_player'), where('deviceUuid', '==', uid)),
      )
      const ownRows = ownSnapshot.docs.map((snapshotDoc) => snapshotDoc.data() as GamePlayer)

      if (ownRows.length === 0) {
        stats.value = playerStats(uid, [])
        opponents.value = []
        status.value = 'empty'
        return
      }

      const gameIdChunks = chunk(
        [...new Set(ownRows.map((row) => row.gameId))],
        IN_QUERY_CHUNK_SIZE,
      )

      const [playerSnapshots, resultSnapshots] = await Promise.all([
        Promise.all(
          gameIdChunks.map((ids) =>
            getDocs(query(collection(db, 'game_player'), where('gameId', 'in', ids))),
          ),
        ),
        Promise.all(
          gameIdChunks.map((ids) =>
            getDocs(query(collection(db, 'game_result'), where(documentId(), 'in', ids))),
          ),
        ),
      ])

      const rowsByDocId = new Map<string, GamePlayer>()
      for (const snapshot of playerSnapshots) {
        for (const snapshotDoc of snapshot.docs) {
          rowsByDocId.set(snapshotDoc.id, snapshotDoc.data() as GamePlayer)
        }
      }
      const allRows = [...rowsByDocId.values()]

      const finishedAtByGameId = new Map<string, string>()
      for (const snapshot of resultSnapshots) {
        for (const snapshotDoc of snapshot.docs) {
          finishedAtByGameId.set(snapshotDoc.id, (snapshotDoc.data() as GameResult).finishedAt)
        }
      }

      stats.value = playerStats(uid, allRows)
      opponents.value = buildOpponentRecords(uid, allRows, finishedAtByGameId)
      status.value = 'loaded'
    } catch {
      status.value = 'error'
    }
  }

  return { status, stats, opponents, load }
})
