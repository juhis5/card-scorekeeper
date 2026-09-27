/**
 * Fixed Rommi (Finnish Rummy) rules — card values, the 5-round contract progression, and
 * winner determination. Pure, deterministic, no I/O. See docs/PLAN.md "confirmed rules".
 *
 * The game is played with 2 (sometimes 3) decks shuffled together, so a hand can hold the same
 * card more than once. Nothing here assumes one copy per card — a hand is scored per physical card.
 */
import type { Card, Contract, ContractRoundNumber, Player, RoundScore, Standing } from './types'

export const LOW_NUMBER_CARD_VALUE = 5
export const TEN_VALUE = 10
export const FACE_CARD_VALUE = 10
export const ACE_VALUE = 15
export const JOKER_VALUE = 25

/** Point value of a single leftover card (counts against the holder — low is good). */
export function cardValue(card: Card): number {
  if (card.rank === 'Joker') return JOKER_VALUE
  if (card.rank === 'A') return ACE_VALUE
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return FACE_CARD_VALUE
  if (card.rank === '10') return TEN_VALUE
  return LOW_NUMBER_CARD_VALUE
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

/**
 * Rounds 1..`throughRound` a player has no score for. A late joiner must fill these in (they were
 * at the table, just not in the app yet), so nobody is ranked on fewer rounds than the others.
 */
export function missingRounds(
  playerId: string,
  roundScores: RoundScore[],
  throughRound: ContractRoundNumber,
): ContractRoundNumber[] {
  const scoredRounds = new Set(
    roundScores.filter((score) => score.playerId === playerId).map((score) => score.round),
  )
  return CONTRACTS.map((contract) => contract.round).filter(
    (round) => round <= throughRound && !scoredRounds.has(round),
  )
}

/** True when every player has a score for every round so far: the gate for Next and Finish. */
export function isEveryRoundScored(
  playerIds: string[],
  roundScores: RoundScore[],
  throughRound: ContractRoundNumber,
): boolean {
  return playerIds.every(
    (playerId) => missingRounds(playerId, roundScores, throughRound).length === 0,
  )
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

/** Every card value is a multiple of this, so any valid leftover-card total must also be one. */
export const ROUND_SCORE_STEP = 5

/** Longest display name, enforced identically by firestore.rules on player documents. */
export const MAX_PLAYER_NAME_LENGTH = 40

/** Sanity cap on one round's score (40 jokers), enforced identically by firestore.rules. */
export const MAX_ROUND_SCORE = 1000

/** A leftover-card total: a whole number from 0 to `MAX_ROUND_SCORE` in steps of
 * `ROUND_SCORE_STEP`. Negative zero is rejected because Firestore stores it as a double, which
 * the rules' `is int` check refuses. */
export function isValidRoundScore(points: number): boolean {
  return (
    Number.isInteger(points) &&
    !Object.is(points, -0) &&
    points >= 0 &&
    points <= MAX_ROUND_SCORE &&
    points % ROUND_SCORE_STEP === 0
  )
}
