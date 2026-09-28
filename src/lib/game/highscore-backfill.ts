/** The one-time backfill of the public lists for games finished before they existed (see
 * docs/RELEASE.md). Pure, so scripts/backfill-highscores.ts only reads and writes. */
import { nextPlayerTotals, type PlayerTotals } from './stats'
import type { GamePlayer, GameStatus } from './types'

export interface BackfillGame {
  gameId: string
  finishedAt: string
  participantUids: string[]
  /** The room's status, or null for a local game (no room). */
  roomStatus: GameStatus | null
  rows: GamePlayer[]
}

export interface BackfillEntry {
  id: string
  data: { displayName: string; finalScore: number; worstRound: number; finishedAt: string }
}

export interface BackfillPlan {
  entries: BackfillEntry[]
  totals: { uid: string; data: PlayerTotals }[]
}

/** What firebase/firestore.rules lets onto the public lists: a finished online room with at least
 * two players (guests count). */
function counts(game: BackfillGame): boolean {
  return game.roomStatus === 'finished' && game.participantUids.length >= 2
}

/**
 * Entries for counted rows that don't have one yet, and every affected player's totals rebuilt
 * from all their counted games, oldest first. Rebuilt, never incremented, so it is safe to rerun.
 */
export function planHighscoreBackfill(
  games: readonly BackfillGame[],
  existingEntryIds: ReadonlySet<string>,
): BackfillPlan {
  const counted = games
    .filter(counts)
    .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
    .flatMap((game) =>
      game.rows.map((row) => ({ id: `${game.gameId}_${row.deviceUuid}`, row, game })),
    )

  const entries = counted
    .filter(({ id }) => !existingEntryIds.has(id))
    .map(({ id, row, game }) => ({
      id,
      data: {
        displayName: row.displayName,
        finalScore: row.finalScore,
        worstRound: row.worstRound,
        finishedAt: game.finishedAt,
      },
    }))

  const totalsByUid = new Map<string, PlayerTotals>()
  for (const { id, row } of counted) {
    totalsByUid.set(
      row.deviceUuid,
      nextPlayerTotals(totalsByUid.get(row.deviceUuid) ?? null, row, id),
    )
  }
  const totals = [...totalsByUid].map(([uid, data]) => ({ uid, data }))

  return { entries, totals }
}
