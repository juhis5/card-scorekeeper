/**
 * The seam between the game/domain layer and the data layer. A single `GameRepository`
 * interface is implemented by both `LocalGameRepository` (offline, single device, this
 * slice) and, in a later slice, `FirestoreGameRepository` (online, room-code multiplayer)
 * — the game store and UI above never change between modes.
 *
 * Kept intentionally small and mode-agnostic: no field here assumes a network, a document
 * database, or a single device. See docs/PLAN.md "Offline host mode" and the
 * firestore-realtime skill for the two implementations this interface must serve.
 */
import type { ContractRoundNumber, GameResult, GameState } from './types'

export type GameId = string
export type PlayerId = string
export type Unsubscribe = () => void

/** What starting a new game needs, regardless of mode. */
export interface GameConfig {
  hostDeviceUuid: string
  hostDisplayName: string
}

/** Result of creating a game. `roomCode` is null in local (offline) mode — nothing to join by code. */
export interface CreatedGame {
  gameId: GameId
  roomCode: string | null
  /** The id of the player THIS device (the host) was seated as — Local: the generated host
   * player id; Firestore: the host's auth uid. Lets the caller (the game store) record which
   * seated player is "me", the same way `join`'s return value does for a joiner. */
  hostPlayerId: PlayerId
}

/** Adds someone other than the host — the host is seated automatically by `createGame`. */
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
  /**
   * Starts a new game. Local mode assigns a gameId with no room code; online mode also mints
   * a room code. **Invariant every implementation must uphold:** the host plays too, so
   * `createGame` seats them as the game's first player — using `config.hostDisplayName` for
   * their name and recording `config.hostDeviceUuid` as their device identity — before
   * returning. `addPlayer` is only for seating everyone else afterward.
   */
  createGame(config: GameConfig): Promise<CreatedGame>
  /** Adds a person other than the host to the game (local host adding each remaining player in
   * turn, or one device joining online) and returns their playerId. */
  addPlayer(input: AddPlayerInput): Promise<PlayerId>
  /** Host only: seats a player without a device of their own, whose scores the host enters. At
   * the start or mid-game; a mid-game guest fills in the rounds they missed, like a late joiner.
   * Rejects with NameTakenError for a name already in the game. */
  addGuest(input: AddGuestInput): Promise<PlayerId>
  /** Emits the current GameState immediately, then again on every subsequent mutation, until
   * unsubscribed. `onError` hears about a live connection that has stopped (online only), e.g.
   * this device's seat was removed or the room closed. */
  subscribe(onChange: (state: GameState) => void, onError?: (error: unknown) => void): Unsubscribe
  setRoundScore(input: SetRoundScoreInput): Promise<void>
  /** Host only: removes a seat and all its scores (a stalled or mistaken player). Rejects for the
   * host's own seat, which the game can't run without. */
  removePlayer(playerId: PlayerId): Promise<void>
  /** Moves to the next of the 5 fixed rounds. */
  advanceRound(): Promise<void>
  /** Finalizes the game and returns its result. */
  finishGame(): Promise<GameResult>
  /** Tears down any subscription/connection this repository holds. */
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

/** An online room whose host can point it at the next game once it has finished (Play again). */
export interface ReplayableGameRepository extends GameRepository {
  /** Host only, finished room only: records the next room's code, which every device in this
   * room then sees as `GameState.nextRoomCode`. Set once; firestore.rules refuses a change. */
  linkNextRoom(nextRoomCode: string): Promise<void>
}

export function isReplayable(repository: GameRepository): repository is ReplayableGameRepository {
  return 'linkNextRoom' in repository
}
