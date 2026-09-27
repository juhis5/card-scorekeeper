/**
 * The scoreboard's rows. A round's numbers are revealed only once the round is complete (the host
 * moved on, or finished the game); during a round the board only says who has entered. Totals and
 * ranking count revealed rounds only, so they change when a round is revealed, not with every
 * score. Pure: callers pass players, scores and how many rounds are complete.
 */
import { CONTRACTS, pointsFor, standings, TOTAL_ROUNDS } from './rules'
import type { ContractRoundNumber, Player, RoundScore } from './types'

export type RoundCell = { kind: 'points'; points: number } | { kind: 'entered' } | { kind: 'empty' }

export interface BoardRow {
  player: Player
  /** One per round, 1 to 5. */
  cells: RoundCell[]
  /** Points across revealed rounds only. */
  total: number
  /** Standard competition ranking (1, 1, 3), or null while a revealed round is still missing:
   * a late joiner's low total means nothing until their missed rounds are filled in. */
  placement: number | null
}

const ROUNDS: readonly ContractRoundNumber[] = CONTRACTS.map((contract) => contract.round)

function cellFor(points: number | null, round: number, completedRounds: number): RoundCell {
  if (round <= completedRounds)
    return points === null ? { kind: 'empty' } : { kind: 'points', points }
  const isCurrentRound = round === completedRounds + 1 && completedRounds < TOTAL_ROUNDS
  return isCurrentRound && points !== null ? { kind: 'entered' } : { kind: 'empty' }
}

function rowFor(player: Player, roundScores: RoundScore[], completedRounds: number) {
  const cells = ROUNDS.map((round) =>
    cellFor(pointsFor(player.id, round, roundScores), round, completedRounds),
  )
  const revealed = cells.slice(0, completedRounds)
  const total = revealed.reduce((sum, cell) => sum + (cell.kind === 'points' ? cell.points : 0), 0)
  const isComplete = revealed.every((cell) => cell.kind === 'points')
  return { player, cells, total, isComplete }
}

/** Rows sorted for the board: ranked players by revealed total (lowest leads), then anyone with a
 * revealed round still to fill, unranked. */
export function boardRows(
  players: Player[],
  roundScores: RoundScore[],
  completedRounds: number,
): BoardRow[] {
  const rows = players.map((player) => rowFor(player, roundScores, completedRounds))
  const rowsById = new Map(rows.map((row) => [row.player.id, row]))

  const ranked = standings(
    rows.filter((row) => row.isComplete).map((row) => ({ ...row.player, totalScore: row.total })),
  ).map(({ player, placement }): BoardRow => {
    const row = rowsById.get(player.id)
    if (!row) throw new Error(`boardRows: no row for ${player.id}`)
    return { player: row.player, cells: row.cells, total: row.total, placement }
  })

  const unranked = rows
    .filter((row) => !row.isComplete)
    .sort((a, b) => a.total - b.total)
    .map(({ player, cells, total }): BoardRow => ({ player, cells, total, placement: null }))

  return [...ranked, ...unranked]
}
