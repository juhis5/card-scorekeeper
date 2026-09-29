export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades'

export type NumberRank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
export type FaceRank = 'J' | 'Q' | 'K'
export type Rank = NumberRank | FaceRank | 'A' | 'Joker'

export type Card = { rank: Exclude<Rank, 'Joker'>; suit: Suit } | { rank: 'Joker'; suit: null }

export interface MeldRequirement {
  setsOfThree: number
  flushes: number
}

export type ContractRoundNumber = 1 | 2 | 3 | 4 | 5
/** i18n key of a round's contract description. */
export type ContractKey = `contract.round${ContractRoundNumber}`

export interface Contract {
  round: ContractRoundNumber
  contractKey: ContractKey
  melds: MeldRequirement
}

/** One player's leftover-card points for a round. */
export interface RoundScore {
  round: ContractRoundNumber
  playerId: string
  points: number
}

export interface Player {
  id: string
  name: string
  /** Lowest wins. */
  totalScore: number
  /** Online only: a player without a phone, seated by the host, who scores for them. */
  isGuest?: boolean
  /** Online only: a guest the host invited by their claimed name; the game counts for this
   * account once they accept on their own phone. */
  invitedUid?: string
}

/** 'abandoned': the host ended the game early; nothing about it is recorded. */
export type GameStatus = 'waiting' | 'playing' | 'finished' | 'abandoned'

export interface GameState {
  status: GameStatus
  currentRound: ContractRoundNumber
  players: Player[]
  roundScores: RoundScore[]
  /** Online only: the room the host started from this finished one (Play again). */
  nextRoomCode?: string
  /** Online only: the host already seated this device in the next room, so it can move there
   * without joining. */
  hasSeatInNextRoom?: boolean
}

export interface Standing {
  player: Player
  total: number
  /** Ties share a placement: 1, 1, 3. */
  placement: number
}

/** Written once a game finishes. Rooms expire; these records stay, so stats survive. */
export interface GameResult {
  gameId: string
  finishedAt: string
  totalRounds: number
}

/** One row per player per finished game. */
export interface GamePlayer {
  gameId: string
  deviceUuid: string
  displayName: string
  finalScore: number
  placement: number
  bestRound: number
  worstRound: number
  /** An invited player's row: the guest seat it counts as theirs (that guest's row then drops out
   * of every stats view). */
  replacesGuestId?: string
}
