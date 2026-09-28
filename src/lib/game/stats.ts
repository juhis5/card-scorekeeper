/** Stats derived from `GamePlayer` rows alone, grouped by `gameId`. The math can't tell a real
 * device from a local game's synthetic id, so callers pass only real devices' rows. */
import { placements, runningTotal } from './rules'
import type { GamePlayer, Player, RoundScore } from './types'

export interface PlayerStats {
  deviceUuid: string
  gamesPlayed: number
  wins: number
  /** 0, not NaN, with no games. */
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

/** Filters to `deviceUuid`, so callers can pass every loaded row. */
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
  /** Games both played, not either one's total. */
  gamesPlayed: number
  wins: number
  losses: number
  ties: number
}

/** Across the games both played: the lower placement wins, an equal one is a tie. */
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

/** Lowest and highest round. Throws on an empty list: there's no best of zero rounds. */
export function bestAndWorstRound(points: readonly number[]): {
  bestRound: number
  worstRound: number
} {
  if (points.length === 0) {
    throw new RangeError('bestAndWorstRound: requires at least one round of points')
  }
  return { bestRound: Math.min(...points), worstRound: Math.max(...points) }
}

/** Games a player needs before the win-rate and average lists rank them. */
export const QUALIFYING_GAMES = 5

/** A player's running totals across every game, for the global player lists (fifth round).
 * `firebase/firestore.rules` recomputes the same fields; change both together. */
export interface PlayerTotals {
  /** From their latest game. */
  displayName: string
  gamesPlayed: number
  wins: number
  scoreSum: number
  winRate: number
  averageScore: number
  qualified: boolean
  /** The leaderboard entry this update counted: each game's row counts once. */
  lastEntry: string
}

/** A win is placing first, ties included, as in `playerStats`. */
export function nextPlayerTotals(
  previous: PlayerTotals | null,
  row: GamePlayer,
  entryId: string,
): PlayerTotals {
  const gamesPlayed = (previous?.gamesPlayed ?? 0) + 1
  const wins = (previous?.wins ?? 0) + (row.placement === 1 ? 1 : 0)
  const scoreSum = (previous?.scoreSum ?? 0) + row.finalScore
  return {
    displayName: row.displayName,
    gamesPlayed,
    wins,
    scoreSum,
    winRate: wins / gamesPlayed,
    averageScore: scoreSum / gamesPlayed,
    qualified: gamesPlayed >= QUALIFYING_GAMES,
    lastEntry: entryId,
  }
}

/** A finished game's stats rows, one per player, keyed by each player's id. Placed on totals
 * summed from the round scores, never a stored total: these rows are permanent. Every player has
 * a score for every round by then (canFinishGame). */
export function gamePlayerRows(
  gameId: string,
  players: readonly Player[],
  roundScores: RoundScore[],
): GamePlayer[] {
  const totalled = players.map((player) => ({
    ...player,
    totalScore: runningTotal(player.id, roundScores),
  }))
  return placements(totalled).map(({ player, placement }) => {
    const points = roundScores
      .filter((score) => score.playerId === player.id)
      .map((score) => score.points)
    return {
      gameId,
      deviceUuid: player.id,
      displayName: player.name,
      finalScore: player.totalScore,
      placement,
      ...bestAndWorstRound(points),
    }
  })
}
