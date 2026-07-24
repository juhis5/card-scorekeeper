/**
 * Persistent player stats — pure derivation over `GamePlayer[]` rows (see docs/PLAN.md "Stats &
 * history" and docs/DECISIONS.md's 2026-07-24 "Stats identity keying" entry). No I/O: every row
 * this module reads is already in memory (loaded from `game_player` by whatever calls in from
 * the stats store/view, a later slice) — this file only computes numbers from them.
 *
 * `GameResult[]` turns out NOT to be needed here: every fact "Stats tracked" in docs/PLAN.md asks
 * for (games played, wins, best/worst score, best/worst round, averages, head-to-head) is already
 * on each `GamePlayer` row (including its own `gameId`), so grouping by `gameId` within
 * `GamePlayer[]` alone is sufficient — matching docs/PLAN.md's "Head-to-head is derived by
 * comparing placement... across games that share a game_id — no separate table needed."
 *
 * Identity caveat (per DECISIONS): these functions don't know or care whether a `deviceUuid` is a
 * real device or a local game's synthetic per-game id — that distinction is the caller's
 * responsibility (only real devices' rows should be fed in for aggregation); the math here is the
 * same either way.
 */
import type { GamePlayer } from './types'

export interface PlayerStats {
  deviceUuid: string
  gamesPlayed: number
  wins: number
  /** `0` (not `null`) when `gamesPlayed` is 0 — "0 games, 0% win rate" reads better than NaN. */
  winRate: number
  bestFinalScore: number | null
  worstFinalScore: number | null
  bestRound: number | null
  worstRound: number | null
  averageFinalScore: number | null
}

const NO_GAMES_STATS_EXCEPT_IDENTITY = {
  gamesPlayed: 0,
  wins: 0,
  winRate: 0,
  bestFinalScore: null,
  worstFinalScore: null,
  bestRound: null,
  worstRound: null,
  averageFinalScore: null,
} as const

/**
 * Derives one player's stats from every `GamePlayer` row across every finished game, theirs and
 * others' alike — filters to `deviceUuid` internally so callers can pass the whole loaded table.
 */
export function playerStats(deviceUuid: string, games: GamePlayer[]): PlayerStats {
  const own = games.filter((game) => game.deviceUuid === deviceUuid)
  if (own.length === 0) {
    return { deviceUuid, ...NO_GAMES_STATS_EXCEPT_IDENTITY }
  }

  const finalScores = own.map((game) => game.finalScore)
  const bestRounds = own.map((game) => game.bestRound)
  const worstRounds = own.map((game) => game.worstRound)
  const wins = own.filter((game) => game.placement === 1).length

  return {
    deviceUuid,
    gamesPlayed: own.length,
    wins,
    winRate: wins / own.length,
    bestFinalScore: Math.min(...finalScores),
    worstFinalScore: Math.max(...finalScores),
    bestRound: Math.min(...bestRounds),
    worstRound: Math.max(...worstRounds),
    averageFinalScore: finalScores.reduce((total, score) => total + score, 0) / own.length,
  }
}

export interface HeadToHeadRecord {
  deviceUuid: string
  opponentDeviceUuid: string
  /** Games where BOTH device UUIDs have a row — not either player's total games played. */
  gamesPlayed: number
  wins: number
  losses: number
  ties: number
}

/**
 * `deviceUuid`'s record against `opponentDeviceUuid`, across every game both of them share (same
 * `gameId`). Lower `placement` wins that game; equal placement (co-winner tie, or any other
 * shared placement) is a tie. Symmetric: swapping the two arguments swaps wins and losses.
 */
export function headToHead(
  deviceUuid: string,
  opponentDeviceUuid: string,
  games: GamePlayer[],
): HeadToHeadRecord {
  const rowsByGameId = new Map<string, GamePlayer[]>()
  for (const game of games) {
    const rows = rowsByGameId.get(game.gameId) ?? []
    rows.push(game)
    rowsByGameId.set(game.gameId, rows)
  }

  let gamesPlayed = 0
  let wins = 0
  let losses = 0
  let ties = 0

  for (const rows of rowsByGameId.values()) {
    const mine = rows.find((row) => row.deviceUuid === deviceUuid)
    const theirs = rows.find((row) => row.deviceUuid === opponentDeviceUuid)
    if (!mine || !theirs) continue

    gamesPlayed += 1
    if (mine.placement < theirs.placement) wins += 1
    else if (mine.placement > theirs.placement) losses += 1
    else ties += 1
  }

  return { deviceUuid, opponentDeviceUuid, gamesPlayed, wins, losses, ties }
}

/**
 * The best (lowest) and worst (highest) single-round point total from one player's round scores
 * in one game — feeds `GamePlayer.bestRound`/`worstRound` at persistence time (see
 * `local-repository.ts` and `firestore-repository.ts`'s `finishGame`). Throws on an empty list —
 * there is no best/worst of zero rounds; callers with no recorded rounds for a player must guard
 * before calling this, the same way `rules.ts#contractForRound` throws on an invalid round rather
 * than silently returning a meaningless value.
 */
export function bestAndWorstRound(points: readonly number[]): {
  bestRound: number
  worstRound: number
} {
  if (points.length === 0) {
    throw new RangeError('bestAndWorstRound: requires at least one round of points')
  }
  return { bestRound: Math.min(...points), worstRound: Math.max(...points) }
}
