/**
 * Fixed Rommi (Finnish Rummy) rules — card values, the 5-round contract progression, and
 * winner determination. Pure, deterministic, no I/O. See docs/PLAN.md "confirmed rules".
 */
import type { Card, Contract, Player, RoundScore, Standing } from './types'

export const FACE_CARD_VALUE = 10
export const ACE_VALUE = 15
export const JOKER_VALUE = 25

/** Point value of a single leftover card (counts against the holder — low is good). */
export function cardValue(card: Card): number {
  if (card.rank === 'Joker') return JOKER_VALUE
  if (card.rank === 'A') return ACE_VALUE
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return FACE_CARD_VALUE
  return Number(card.rank)
}

/** Sums the leftover-card points for a hand at the end of a round. */
export function roundTotal(cards: Card[]): number {
  return cards.reduce((total, card) => total + cardValue(card), 0)
}

export const TOTAL_ROUNDS = 5

/** The 5 fixed contract rounds, in order. Descriptions are display-only and live in locales. */
export const CONTRACTS: readonly Contract[] = [
  { round: 1, contractKey: 'contract.round1', melds: { setsOfThree: 2, flushes: 0 } },
  { round: 2, contractKey: 'contract.round2', melds: { setsOfThree: 1, flushes: 1 } },
  { round: 3, contractKey: 'contract.round3', melds: { setsOfThree: 3, flushes: 0 } },
  { round: 4, contractKey: 'contract.round4', melds: { setsOfThree: 2, flushes: 1 } },
  { round: 5, contractKey: 'contract.round5', melds: { setsOfThree: 1, flushes: 2 } },
]

/** Looks up the contract for a round. Throws for any round outside 1..TOTAL_ROUNDS. */
export function contractForRound(round: number): Contract {
  const contract = CONTRACTS.find((candidate) => candidate.round === round)
  if (!contract) {
    throw new RangeError(`round must be between 1 and ${TOTAL_ROUNDS}, got ${round}`)
  }
  return contract
}

/** A player's accumulated points across all recorded rounds so far. */
export function runningTotal(playerId: string, roundScores: RoundScore[]): number {
  return roundScores
    .filter((score) => score.playerId === playerId)
    .reduce((total, score) => total + score.points, 0)
}

/**
 * Ranks players by total ascending (lowest = best) using standard competition ranking:
 * equal totals share a placement, and the next distinct total skips ahead (1, 1, 3).
 */
function rankAscending(players: Player[]): Standing[] {
  const sorted = [...players].sort((a, b) => a.totalScore - b.totalScore)

  let previousTotal: number | null = null
  let previousPlacement = 0

  return sorted.map((player, index) => {
    const placement = player.totalScore === previousTotal ? previousPlacement : index + 1
    previousTotal = player.totalScore
    previousPlacement = placement
    return { player, total: player.totalScore, placement }
  })
}

/** Current standings, sorted ascending so the leader (lowest total) is first. */
export function standings(players: Player[]): Standing[] {
  return rankAscending(players)
}

/** Final ranking after round 5 — same ranking as `standings`, named for that call site. */
export function placements(players: Player[]): Standing[] {
  return rankAscending(players)
}

/** All players sharing the lowest total (placement 1) — a single winner, or tied co-winners. */
export function winners(players: Player[]): Standing[] {
  const ranked = placements(players)
  const [leader] = ranked
  if (!leader) return []
  return ranked.filter((standing) => standing.placement === leader.placement)
}
