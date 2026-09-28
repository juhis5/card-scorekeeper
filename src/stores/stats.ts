/**
 * This device's stats and head-to-head records, keyed on the Firebase anonymous uid, not the
 * identity store's deviceUuid. Reads only games this device played; the math is in lib/game/stats.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { headToHead, playerStats } from '@/lib/game/stats'
import type { HeadToHeadRecord, PlayerStats } from '@/lib/game/stats'
import type { GamePlayer } from '@/lib/game/types'
import { reportHandledError } from '@/lib/platform/error-reporting'

export type StatsStatus = 'loading' | 'loaded' | 'empty' | 'error'

export interface OpponentRecord {
  opponentDeviceUuid: string
  /** From the most recently finished shared game. `game_player` rows carry no timestamp, so
   * `game_result.finishedAt` decides. */
  displayName: string
  record: HeadToHeadRecord
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
      const { connectIfReachable, readPlayedGames } = await import('@/lib/data/stats-reads')
      const connection = await connectIfReachable()
      if (!connection) {
        status.value = 'error'
        return
      }
      const { uid } = connection
      const { rows, finishedAtByGameId } = await readPlayedGames(connection)
      stats.value = playerStats(uid, rows)
      opponents.value = buildOpponentRecords(uid, rows, finishedAtByGameId)
      status.value = rows.length === 0 ? 'empty' : 'loaded'
    } catch (error) {
      reportHandledError(error, 'load-stats')
      status.value = 'error'
    }
  }

  return { status, stats, opponents, load }
})
