/** The seam between the store and the data layer: `LocalGameRepository` offline,
 * `FirestoreGameRepository` online. Keep it mode-agnostic. */
import type { ContractRoundNumber, GameResult, GameState } from '../game/types'

export type GameId = string
export type PlayerId = string
export type Unsubscribe = () => void

export interface GameConfig {
  hostDeviceUuid: string
  hostDisplayName: string
}

export interface CreatedGame {
  gameId: GameId
  /** Null for a local game. */
  roomCode: string | null
  /** The host's seat, so the store knows which player is "me". */
  hostPlayerId: PlayerId
}

/** Anyone but the host, whom `createGame` seats. */
export interface AddPlayerInput {
  name: string
  deviceUuid: string
}

/** A player without a device of their own: the host adds them and enters their scores. */
export interface AddGuestInput {
  name: string
}

export interface SetRoundScoreInput {
  playerId: PlayerId
  round: ContractRoundNumber
  points: number
}

export interface GameRepository {
  /** Every implementation seats the host as the first player before returning. */
  createGame(config: GameConfig): Promise<CreatedGame>
  /** Seats someone other than the host: each player a local host adds, or a device joining. */
  addPlayer(input: AddPlayerInput): Promise<PlayerId>
  /** Host only: seats a player without a device, whose scores the host enters. A mid-game guest
   * fills in missed rounds like a late joiner. Rejects with NameTakenError for a taken name. */
  addGuest(input: AddGuestInput): Promise<PlayerId>
  /** Emits the state now and after every change. `onError` hears that a live connection stopped
   * (online only), e.g. this device's seat was removed. */
  subscribe(onChange: (state: GameState) => void, onError?: (error: unknown) => void): Unsubscribe
  setRoundScore(input: SetRoundScoreInput): Promise<void>
  /** Host only: removes a seat and its scores. Rejects for the host's own seat. */
  removePlayer(playerId: PlayerId): Promise<void>
  advanceRound(): Promise<void>
  finishGame(): Promise<GameResult>
  /** Stops every live subscription. */
  leave(): void
}

/** This device's seat in an online room, found again after a reload. */
export interface Seat {
  playerId: PlayerId
  isHost: boolean
}

/** Whether a room can still be joined: 'expired' wins over 'finished'. */
export type RoomAvailability = 'open' | 'finished' | 'expired' | 'missing'

/** An online repository that can find this device's existing seat, so a reload resumes the game
 * instead of losing it. */
export interface ResumableGameRepository extends GameRepository {
  /** `null` when this device has no seat in the room, or the room doesn't exist. */
  findSeat(): Promise<Seat | null>
  /** Reads the room, so a join link can say "this game has ended" instead of a failed join. */
  roomAvailability(): Promise<RoomAvailability>
}

export function isResumable(repository: GameRepository): repository is ResumableGameRepository {
  return 'findSeat' in repository
}

/** An online room whose host can start the next game from it once it has finished (Play again). */
export interface ReplayableGameRepository extends GameRepository {
  /** Like `createGame`, for a room that names the finished room its players come from. */
  createNextGame(config: GameConfig, previousRoomCode: string): Promise<CreatedGame>
  /** Host only, finished room only: records the next room's code, which every device in this
   * room then sees as `GameState.nextRoomCode`. Set once; firestore.rules refuses a change. */
  linkNextRoom(nextRoomCode: string): Promise<void>
  /** Host only, once the finished room links here: seats everyone else from it as they were. Each
   * seat on its own, so one refused seat (someone who joined first) doesn't stop the rest. */
  carrySeats(): Promise<void>
}

export function isReplayable(repository: GameRepository): repository is ReplayableGameRepository {
  return 'linkNextRoom' in repository
}
