/** Fixed Rommi rules. Played with 2 or 3 decks, so a hand can hold the same card twice and is
 * scored per physical card. */
import type {
  Card,
  Contract,
  ContractRoundNumber,
  GameStatus,
  Player,
  RoundScore,
  Standing,
} from './types.js'

export const LOW_NUMBER_CARD_VALUE = 5
export const TEN_VALUE = 10
export const FACE_CARD_VALUE = 10
export const ACE_VALUE = 15
export const JOKER_VALUE = 25

/** Points a leftover card counts against its holder. */
export function cardValue(card: Card): number {
  if (card.rank === 'Joker') return JOKER_VALUE
  if (card.rank === 'A') return ACE_VALUE
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return FACE_CARD_VALUE
  if (card.rank === '10') return TEN_VALUE
  return LOW_NUMBER_CARD_VALUE
}

export function roundTotal(cards: Card[]): number {
  return cards.reduce((total, card) => total + cardValue(card), 0)
}

export const TOTAL_ROUNDS = 5

/** Descriptions live in the locales. */
export const CONTRACTS: readonly Contract[] = [
  { round: 1, contractKey: 'contract.round1', melds: { setsOfThree: 2, flushes: 0 } },
  { round: 2, contractKey: 'contract.round2', melds: { setsOfThree: 1, flushes: 1 } },
  { round: 3, contractKey: 'contract.round3', melds: { setsOfThree: 3, flushes: 0 } },
  { round: 4, contractKey: 'contract.round4', melds: { setsOfThree: 2, flushes: 1 } },
  { round: 5, contractKey: 'contract.round5', melds: { setsOfThree: 1, flushes: 2 } },
]

/** Throws for a round outside 1..TOTAL_ROUNDS. */
export function contractForRound(round: number): Contract {
  const contract = CONTRACTS.find((candidate) => candidate.round === round)
  if (!contract) {
    throw new RangeError(`round must be between 1 and ${TOTAL_ROUNDS}, got ${round}`)
  }
  return contract
}

/** Unscored rounds up to `throughRound`. A late joiner fills these in (they were at the table,
 * just not in the app), so nobody is ranked on fewer rounds than the others. */
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

/** Rounds so far where more than one seated player has 0. Only the player who went out scores
 * nothing, so such a round has a typo in it, and Next waits until it's fixed. */
export function roundsWithSeveralZeros(
  playerIds: string[],
  roundScores: RoundScore[],
  throughRound: ContractRoundNumber,
): ContractRoundNumber[] {
  const seated = new Set(playerIds)
  return CONTRACTS.map((contract) => contract.round).filter(
    (round) =>
      round <= throughRound &&
      roundScores.filter(
        (score) => score.round === round && score.points === 0 && seated.has(score.playerId),
      ).length > 1,
  )
}

/** Rounds whose scores are settled: those before the current one, or all of them once the game
 * is finished. The scoreboard marks a leader only after the first one. */
export function completedRounds(currentRound: ContractRoundNumber, status: GameStatus): number {
  return status === 'finished' ? TOTAL_ROUNDS : currentRound - 1
}

/** Null when there's no score yet; 0 is a real score. */
export function pointsFor(
  playerId: string,
  round: ContractRoundNumber,
  roundScores: RoundScore[],
): number | null {
  const score = roundScores.find((entry) => entry.playerId === playerId && entry.round === round)
  return score ? score.points : null
}

export function runningTotal(playerId: string, roundScores: RoundScore[]): number {
  return roundScores
    .filter((score) => score.playerId === playerId)
    .reduce((total, score) => total + score.points, 0)
}

/** Lowest total first. Equal totals share a placement and the next one skips ahead: 1, 1, 3. */
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

export function standings(players: Player[]): Standing[] {
  return rankAscending(players)
}

/** Same as `standings`, named for the final ranking. */
export function placements(players: Player[]): Standing[] {
  return rankAscending(players)
}

/** Everyone on the lowest total: one winner or tied co-winners. */
export function winners(players: Player[]): Standing[] {
  const ranked = placements(players)
  const [leader] = ranked
  if (!leader) return []
  return ranked.filter((standing) => standing.placement === leader.placement)
}

/** Every card value is a multiple of this, so any valid leftover-card total must also be one. */
export const ROUND_SCORE_STEP = 5

/** firestore.rules enforces the same limit. */
export const MAX_PLAYER_NAME_LENGTH = 40

/** Sanity cap (40 jokers). firestore.rules enforces the same limit. */
export const MAX_ROUND_SCORE = 1000

/** Rejects -0: Firestore stores it as a double, which the rules' `is int` check refuses. */
export function isValidRoundScore(points: number): boolean {
  return (
    Number.isInteger(points) &&
    !Object.is(points, -0) &&
    points >= 0 &&
    points <= MAX_ROUND_SCORE &&
    points % ROUND_SCORE_STEP === 0
  )
}
