/**
 * A round's numbers show only once it's complete; until then the board only says who has entered.
 * Totals and ranking count revealed rounds only, so they change per round, not with every score.
 */
import { CONTRACTS, pointsFor, rankByTotal, TOTAL_ROUNDS } from './rules'
import type { ContractRoundNumber, Player, RoundScore } from './types'

export type RoundCell = { kind: 'points'; points: number } | { kind: 'entered' } | { kind: 'empty' }

export interface BoardRow {
  player: Player
  cells: RoundCell[]
  /** Revealed rounds only. */
  total: number
  /** 1, 1, 3 ranking, or null while a revealed round is missing: a late joiner's low total means
   * nothing until their missed rounds are filled in. */
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

/** Ranked players, lowest total first, then the unranked ones with a revealed round to fill. */
export function boardRows(
  players: Player[],
  roundScores: RoundScore[],
  completedRounds: number,
): BoardRow[] {
  const rows = players.map((player) => rowFor(player, roundScores, completedRounds))

  const ranked = rankByTotal(
    rows.filter((row) => row.isComplete),
    (row) => row.total,
  ).map(({ item: row, placement }): BoardRow => ({
    player: row.player,
    cells: row.cells,
    total: row.total,
    placement,
  }))

  const unranked = rows
    .filter((row) => !row.isComplete)
    .sort((a, b) => a.total - b.total)
    .map(({ player, cells, total }): BoardRow => ({ player, cells, total, placement: null }))

  return [...ranked, ...unranked]
}
