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
  /** Emits the current GameState immediately, then again on every subsequent mutation, until unsubscribed. */
  subscribe(onChange: (state: GameState) => void): Unsubscribe
  setRoundScore(input: SetRoundScoreInput): Promise<void>
  /** Moves to the next of the 5 fixed rounds. */
  advanceRound(): Promise<void>
  /** Finalizes the game and returns its result. */
  finishGame(): Promise<GameResult>
  /** Tears down any subscription/connection this repository holds. */
  leave(): void
}
