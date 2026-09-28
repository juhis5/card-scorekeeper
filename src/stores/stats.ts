/**
 * This device's stats and head-to-head records, keyed on the Firebase anonymous uid, not the
 * identity store's deviceUuid. Reads only games this device played; the math is in lib/game/stats.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { probeBackendReachable } from '@/lib/platform/connectivity'
import { headToHead, playerStats } from '@/lib/game/stats'
import type { HeadToHeadRecord, PlayerStats } from '@/lib/game/stats'
import type { GamePlayer, GameResult } from '@/lib/game/types'
import { reportHandledError } from '@/lib/platform/error-reporting'

/** Firestore's `in` operator compares against at most 30 values per query. */
const IN_QUERY_CHUNK_SIZE = 30

export type StatsStatus = 'loading' | 'loaded' | 'empty' | 'error'

export interface OpponentRecord {
  opponentDeviceUuid: string
  /** From the most recently finished shared game. `game_player` rows carry no timestamp, so
   * `game_result.finishedAt` decides. */
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

/** The displayName from the most recently finished of `rows` (ISO timestamps sort as strings). */
function mostRecentDisplayName(
  rows: readonly GamePlayer[],
  finishedAtByGameId: ReadonlyMap<string, string>,
): string {
  // Unseeded reduce needs no `rows[0]` assertion; every opponent has at least one row.
  return rows.reduce((best, row) => {
    const bestFinishedAt = finishedAtByGameId.get(best.gameId) ?? ''
    const finishedAt = finishedAtByGameId.get(row.gameId) ?? ''
    return finishedAt >= bestFinishedAt ? row : best
  }).displayName
}

/** Each opponent's latest name and head-to-head record. `rows` includes this device's own. */
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

  /** Never throws: offline, a broken config or a refused read all land on `error`. */
  async function load(): Promise<void> {
    status.value = 'loading'
    try {
      const [
        { getDb, getFirebaseAuth, ensureSignedIn, checkBackendReachable },
        { collection, query, where, getDocs },
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

      // Every stats query filters on participantUids: firestore.rules only lets a player list
      // rows of games they played, and a query must prove that to be allowed.
      const asParticipant = where('participantUids', 'array-contains', uid)
      const ownSnapshot = await getDocs(
        query(collection(db, 'game_player'), where('deviceUuid', '==', uid), asParticipant),
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

      // Every row of those games gives the opponents; the results give their finish times.
      // Results by participant, not `documentId() in`: production refuses that with this filter,
      // though the emulator allows it.
      const [playerSnapshots, resultSnapshot] = await Promise.all([
        Promise.all(
          gameIdChunks.map((ids) =>
            getDocs(
              query(collection(db, 'game_player'), where('gameId', 'in', ids), asParticipant),
            ),
          ),
        ),
        getDocs(query(collection(db, 'game_result'), asParticipant)),
      ])

      const rowsByDocId = new Map<string, GamePlayer>()
      for (const snapshot of playerSnapshots) {
        for (const snapshotDoc of snapshot.docs) {
          rowsByDocId.set(snapshotDoc.id, snapshotDoc.data() as GamePlayer)
        }
      }
      const allRows = [...rowsByDocId.values()]

      const finishedAtByGameId = new Map<string, string>()
      for (const snapshotDoc of resultSnapshot.docs) {
        finishedAtByGameId.set(snapshotDoc.id, (snapshotDoc.data() as GameResult).finishedAt)
      }

      stats.value = playerStats(uid, allRows)
      opponents.value = buildOpponentRecords(uid, allRows, finishedAtByGameId)
      status.value = 'loaded'
    } catch (error) {
      reportHandledError(error, 'load-stats')
      status.value = 'error'
    }
  }

  return { status, stats, opponents, load }
})
