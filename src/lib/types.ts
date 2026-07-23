/** Domain types for the Rommi scorekeeper — see docs/PLAN.md for the data model. */

export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades'

export type NumberRank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
export type FaceRank = 'J' | 'Q' | 'K'
export type Rank = NumberRank | FaceRank | 'A' | 'Joker'

/** A playing card. The Joker has no suit — modeled out rather than left nullable-by-convention. */
export type Card = { rank: Exclude<Rank, 'Joker'>; suit: Suit } | { rank: 'Joker'; suit: null }

/** How many of each meld a round's contract requires. */
export interface MeldRequirement {
  setsOfThree: number
  flushes: number
}

/** Stable i18n message key for a round's contract description (display-only; see locales). */
export type ContractRoundNumber = 1 | 2 | 3 | 4 | 5
export type ContractKey = `contract.round${ContractRoundNumber}`

export interface Contract {
  round: ContractRoundNumber
  contractKey: ContractKey
  melds: MeldRequirement
}

/** One player's leftover-card points for a single round. */
export interface RoundScore {
  round: ContractRoundNumber
  playerId: string
  points: number
}

export interface Player {
  id: string
  name: string
  /** Running total across all scored rounds so far; ascending = winning. */
  totalScore: number
}

export type GameStatus = 'waiting' | 'playing' | 'finished'

export interface GameState {
  status: GameStatus
  currentRound: ContractRoundNumber
  players: Player[]
  roundScores: RoundScore[]
}

/** A player's rank in the current (or final) standings. */
export interface Standing {
  player: Player
  total: number
  /** Standard competition ranking (1, 1, 3) — ties share a placement. */
  placement: number
}

/**
 * Permanent per-game record written once a game finishes (see docs/PLAN.md "Stats & history").
 * Rooms are transient; these two shapes persist so stats survive room expiry.
 */
export interface GameResult {
  gameId: string
  finishedAt: string
  totalRounds: number
  /** A single id, mirroring docs/PLAN.md's data model. When the game ends in a tie, every
   * co-winner has `placement === 1` on their own `GamePlayer` row — that's the source of
   * truth for ties, not this field. */
  winnerUuid: string
}

/** One row per player per finished game — powers stats and head-to-head derivation. */
export interface GamePlayer {
  gameId: string
  deviceUuid: string
  displayName: string
  finalScore: number
  placement: number
  bestRound: number
  worstRound: number
}
