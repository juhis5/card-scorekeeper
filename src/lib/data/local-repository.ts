/** Offline, single-device game, saved to localStorage so a reload resumes it. With no network,
 * `finishGame` queues the stats for the reconnect flush. */
import {
  GameIncompleteError,
  TOTAL_ROUNDS,
  canFinishGame,
  contractForRound,
  runningTotal,
} from '../game/rules'
import { gamePlayerRows } from '../game/stats'
import { appendPendingResult } from './pending-results'
import { cleanPlayerName, isNameTaken, NameTakenError } from '../game/player-names'
import { browserLocalStorage } from './key-value-storage'
import type { KeyValueStorage } from './key-value-storage'
import type {
  ContractRoundNumber,
  GamePlayer,
  GameResult,
  GameState,
  Player,
  RoundScore,
} from '../game/types'
import type {
  AddGuestInput,
  AddPlayerInput,
  CreatedGame,
  GameConfig,
  GameId,
  GameRepository,
  PlayerId,
  SetRoundScoreInput,
  Unsubscribe,
} from './repository'

export const STORAGE_KEY = 'card-scorekeeper:local-game'
const FIRST_ROUND = 1

interface StoredGame {
  gameId: GameId
  hostDeviceUuid: string
  /** Kept outside GameState so a resumed repository can report it (see `getResumeInfo`). */
  hostPlayerId: PlayerId
  state: GameState
}

function initialGameState(): GameState {
  return { status: 'waiting', currentRound: FIRST_ROUND, players: [], roundScores: [] }
}

function emptyStoredGame(): StoredGame {
  return {
    gameId: '',
    hostDeviceUuid: '',
    hostPlayerId: '',
    state: initialGameState(),
  }
}

// Re-exported for the stores and tests that import it from here.
export type { KeyValueStorage }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPlayer(value: unknown): value is Player {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.totalScore === 'number'
  )
}

function isRoundScore(value: unknown): value is RoundScore {
  return (
    isRecord(value) &&
    typeof value.round === 'number' &&
    value.round >= FIRST_ROUND &&
    value.round <= TOTAL_ROUNDS &&
    typeof value.playerId === 'string' &&
    typeof value.points === 'number'
  )
}

function isGameState(value: unknown): value is GameState {
  return (
    isRecord(value) &&
    (value.status === 'waiting' || value.status === 'playing' || value.status === 'finished') &&
    typeof value.currentRound === 'number' &&
    value.currentRound >= FIRST_ROUND &&
    value.currentRound <= TOTAL_ROUNDS &&
    Array.isArray(value.players) &&
    value.players.every(isPlayer) &&
    Array.isArray(value.roundScores) &&
    value.roundScores.every(isRoundScore)
  )
}

/** A schema change, partial write or foreign data under our key reads as no saved game, never a
 * crash. */
function isStoredGame(value: unknown): value is StoredGame {
  return (
    isRecord(value) &&
    typeof value.gameId === 'string' &&
    typeof value.hostDeviceUuid === 'string' &&
    typeof value.hostPlayerId === 'string' &&
    isGameState(value.state)
  )
}

function readStoredGame(storage: KeyValueStorage): StoredGame | null {
  try {
    // Blocked storage throws on read, too: that means no saved game, not a crash.
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isStoredGame(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** A local game was started here, so the room screen can resume it. */
export function hasPersistedGame(storage: KeyValueStorage = browserLocalStorage()): boolean {
  const stored = readStoredGame(storage)
  return stored !== null && stored.gameId !== ''
}

/** The game Home offers to continue, and the one a new local game would replace. */
export function hasUnfinishedPersistedGame(
  storage: KeyValueStorage = browserLocalStorage(),
): boolean {
  const stored = readStoredGame(storage)
  return stored !== null && stored.gameId !== '' && stored.state.status !== 'finished'
}

export interface LocalGameRepositoryDeps {
  now?: () => string
  newId?: () => string
  storage?: KeyValueStorage
}

export class LocalGameRepository implements GameRepository {
  private readonly now: () => string
  private readonly newId: () => string
  private readonly storage: KeyValueStorage
  private readonly listeners = new Set<(state: GameState) => void>()
  private game: StoredGame

  constructor(deps: LocalGameRepositoryDeps = {}) {
    this.now = deps.now ?? (() => new Date().toISOString())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
    this.storage = deps.storage ?? browserLocalStorage()
    this.game = readStoredGame(this.storage) ?? emptyStoredGame()
  }

  async createGame(config: GameConfig): Promise<CreatedGame> {
    const gameId = this.newId()
    const hostPlayerId = this.newId()
    const hostPlayer: Player = {
      id: hostPlayerId,
      name: cleanPlayerName(config.hostDisplayName),
      totalScore: 0,
    }
    this.game = {
      gameId,
      hostDeviceUuid: config.hostDeviceUuid,
      hostPlayerId,
      state: { ...initialGameState(), players: [hostPlayer] },
    }
    this.persistAndNotify()
    return { gameId, roomCode: null, hostPlayerId }
  }

  /** What `createGame()` would have returned, for a repository resumed from storage. */
  getResumeInfo(): { gameId: GameId; hostPlayerId: PlayerId } | null {
    if (!this.game.gameId) return null
    return { gameId: this.game.gameId, hostPlayerId: this.game.hostPlayerId }
  }

  async addPlayer(input: AddPlayerInput): Promise<PlayerId> {
    const name = cleanPlayerName(input.name)
    const existingNames = this.game.state.players.map((player) => player.name)
    if (isNameTaken(name, existingNames)) throw new NameTakenError(name)
    const playerId = this.newId()
    this.game = {
      ...this.game,
      state: {
        ...this.game.state,
        players: [...this.game.state.players, { id: playerId, name, totalScore: 0 }],
      },
    }
    this.persistAndNotify()
    return playerId
  }
  /** Every other player in a local game is already one the host scores for. */
  async addGuest(input: AddGuestInput): Promise<PlayerId> {
    return this.addPlayer({ name: input.name, deviceUuid: this.newId() })
  }

  subscribe(onChange: (state: GameState) => void): Unsubscribe {
    this.listeners.add(onChange)
    onChange(this.game.state)
    return () => this.listeners.delete(onChange)
  }

  async setRoundScore(input: SetRoundScoreInput): Promise<void> {
    const roundScores = [
      ...this.game.state.roundScores.filter(
        (score) => !(score.playerId === input.playerId && score.round === input.round),
      ),
      { round: input.round, playerId: input.playerId, points: input.points },
    ]
    const players = this.game.state.players.map((player) =>
      player.id === input.playerId
        ? { ...player, totalScore: runningTotal(player.id, roundScores) }
        : player,
    )
    this.game = {
      ...this.game,
      state: { ...this.game.state, status: 'playing', players, roundScores },
    }
    this.persistAndNotify()
  }

  async removePlayer(playerId: PlayerId): Promise<void> {
    if (playerId === this.game.hostPlayerId) {
      throw new Error("removePlayer: the host's own seat can't be removed")
    }
    const { players, roundScores } = this.game.state
    this.game = {
      ...this.game,
      state: {
        ...this.game.state,
        players: players.filter((player) => player.id !== playerId),
        roundScores: roundScores.filter((score) => score.playerId !== playerId),
      },
    }
    this.persistAndNotify()
  }

  async advanceRound(fromRound: ContractRoundNumber): Promise<void> {
    // A repeat (a double tap) finds the round already moved on and does nothing.
    if (this.game.state.currentRound !== fromRound) return
    const nextRoundNumber = Math.min(fromRound + 1, TOTAL_ROUNDS)
    const nextRound = contractForRound(nextRoundNumber).round
    this.game = {
      ...this.game,
      state: { ...this.game.state, status: 'playing', currentRound: nextRound },
    }
    this.persistAndNotify()
  }

  async finishGame(): Promise<GameResult> {
    const { players, roundScores, currentRound } = this.game.state
    const playerIds = players.map((player) => player.id)
    if (!canFinishGame(playerIds, roundScores, currentRound)) throw new GameIncompleteError()
    // The host's row first: if it can't be built, the game stays unfinished rather than finishing
    // with no result to sync.
    const hostRow = this.buildHostGamePlayer()
    const result: GameResult = {
      gameId: this.game.gameId,
      finishedAt: this.now(),
      totalRounds: TOTAL_ROUNDS,
    }
    this.game = { ...this.game, state: { ...this.game.state, status: 'finished' } }
    this.persistAndNotify()

    // Best-effort, like persistAndNotify: a queueing failure must not fail the finished game.
    appendPendingResult(this.storage, { result, players: [hostRow] })

    return result
  }

  /** Deletes the game on this device: no result is queued. Listeners hear it ended. */
  async abandonGame(): Promise<void> {
    const ended: GameState = { ...this.game.state, status: 'abandoned' }
    this.game = emptyStoredGame()
    this.persistAndNotify()
    this.listeners.forEach((listener) => listener(ended))
  }

  leave(): void {
    this.listeners.clear()
  }

  /**
   * Only the host's row: the no-room `game_player` rule accepts only a self-write (deviceUuid ==
   * auth.uid), and co-players' synthetic per-game ids never aggregate anyway.
   */
  private buildHostGamePlayer(): GamePlayer {
    const { roundScores, players } = this.game.state
    const hostRow = gamePlayerRows(this.game.gameId, players, roundScores).find(
      (row) => row.deviceUuid === this.game.hostPlayerId,
    )
    if (!hostRow) {
      throw new Error('finishGame: host player not found among seated players')
    }
    // Keyed by this device for the queue; the flush stamps the uid signed in at upload time.
    return { ...hostRow, deviceUuid: this.game.hostDeviceUuid }
  }

  private persistAndNotify(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.game))
    } catch {
      // Best-effort (Safari private mode has zero quota): the game runs on, it just won't
      // survive a reload.
    }
    this.listeners.forEach((listener) => listener(this.game.state))
  }
}
