/**
 * LocalGameRepository — offline, single-device GameRepository. In-memory GameState
 * persisted to localStorage so a page reload resumes the same game. No network;
 * `roomCode` is always null. `subscribe` re-emits the full state to a new listener
 * immediately, and to every listener again on each mutation.
 *
 * Persisting the permanent per-player stats rows (`game_result` / `game_player`) on
 * finish is slice 6 — `finishGame` here only computes and returns the `GameResult`.
 */
import { TOTAL_ROUNDS, contractForRound, runningTotal, winners as leadingPlayers } from './rules'
import type { GameResult, GameState, Player, RoundScore } from './types'
import type {
  AddPlayerInput,
  CreatedGame,
  GameConfig,
  GameId,
  GameRepository,
  PlayerId,
  SetRoundScoreInput,
  Unsubscribe,
} from './repository'

/** Exported so tests can pre-seed/inspect the exact key this repository persists under. */
export const STORAGE_KEY = 'card-scorekeeper:local-game'
const FIRST_ROUND = 1

/** Everything this repository persists: the domain GameState plus the bits it alone needs. */
interface StoredGame {
  gameId: GameId
  /** Not enforced in local mode (single device, single host) — kept so a future permission
   * model (or a shared-device edge case) has it available without a repository change. */
  hostDeviceUuid: string
  /** playerId -> deviceUuid. Kept alongside (not inside) GameState so the pure Player type
   * doesn't carry device identity — only this repository needs it, to report a winnerUuid. */
  deviceUuidByPlayerId: Record<PlayerId, string>
  state: GameState
}

function initialGameState(): GameState {
  return { status: 'waiting', currentRound: FIRST_ROUND, players: [], roundScores: [] }
}

function emptyStoredGame(): StoredGame {
  return { gameId: '', hostDeviceUuid: '', deviceUuidByPlayerId: {}, state: initialGameState() }
}

/**
 * The minimal `localStorage` shape this repository needs. Kept as our own interface (decoupled
 * from lib.dom's `Storage`) so tests can inject a plain in-memory fake instead of driving a real
 * browser API — see `tdd`'s "mock I/O at the boundary".
 */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The real browser localStorage, typed as our own `KeyValueStorage` rather than lib.dom's
 * `Storage` and reached via `globalThis` (not the `window` identifier) so it resolves in any
 * global context this class might run in. */
function browserLocalStorage(): KeyValueStorage {
  return (globalThis as unknown as { localStorage: KeyValueStorage }).localStorage
}

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

/** Guards the localStorage boundary: untrusted `unknown` in, a real `StoredGame` or nothing. A
 * schema change, a partial write, or foreign data under our key must never crash the offline
 * host — it must just look like "no saved game" and start fresh. */
function isStoredGame(value: unknown): value is StoredGame {
  return (
    isRecord(value) &&
    typeof value.gameId === 'string' &&
    typeof value.hostDeviceUuid === 'string' &&
    isRecord(value.deviceUuidByPlayerId) &&
    isGameState(value.state)
  )
}

function readStoredGame(storage: KeyValueStorage): StoredGame | null {
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isStoredGame(parsed) ? parsed : null
  } catch {
    // Corrupted or foreign localStorage value under our key — start fresh instead of crashing.
    return null
  }
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
    const hostPlayer: Player = { id: hostPlayerId, name: config.hostDisplayName, totalScore: 0 }
    this.game = {
      gameId,
      hostDeviceUuid: config.hostDeviceUuid,
      deviceUuidByPlayerId: { [hostPlayerId]: config.hostDeviceUuid },
      state: { ...initialGameState(), players: [hostPlayer] },
    }
    this.persistAndNotify()
    return { gameId, roomCode: null, hostPlayerId }
  }

  async addPlayer(input: AddPlayerInput): Promise<PlayerId> {
    const playerId = this.newId()
    this.game = {
      ...this.game,
      deviceUuidByPlayerId: { ...this.game.deviceUuidByPlayerId, [playerId]: input.deviceUuid },
      state: {
        ...this.game.state,
        players: [...this.game.state.players, { id: playerId, name: input.name, totalScore: 0 }],
      },
    }
    this.persistAndNotify()
    return playerId
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

  async advanceRound(): Promise<void> {
    const nextRoundNumber = Math.min(this.game.state.currentRound + 1, TOTAL_ROUNDS)
    const nextRound = contractForRound(nextRoundNumber).round
    this.game = {
      ...this.game,
      state: { ...this.game.state, status: 'playing', currentRound: nextRound },
    }
    this.persistAndNotify()
  }

  async finishGame(): Promise<GameResult> {
    // Only guards "too early" (round not yet reached) — trusts the caller (the UI, gating its
    // Finish button) to have actually collected every player's score for round 5 first.
    if (this.game.state.currentRound !== TOTAL_ROUNDS) {
      throw new Error(
        `finishGame called at round ${this.game.state.currentRound}, before the final round ${TOTAL_ROUNDS}`,
      )
    }
    this.game = { ...this.game, state: { ...this.game.state, status: 'finished' } }
    this.persistAndNotify()

    const [leader] = leadingPlayers(this.game.state.players)
    const winnerUuid = leader ? (this.game.deviceUuidByPlayerId[leader.player.id] ?? '') : ''
    return {
      gameId: this.game.gameId,
      finishedAt: this.now(),
      totalRounds: TOTAL_ROUNDS,
      winnerUuid,
    }
  }

  leave(): void {
    this.listeners.clear()
  }

  private persistAndNotify(): void {
    // Persistence is best-effort: a save failure (e.g. iOS Safari private mode throws on
    // setItem when its quota is 0) must not stop the in-memory game from running — it just
    // means this game won't survive a reload. The live game notifying its subscribers is not
    // allowed to depend on storage succeeding.
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.game))
    } catch {
      // Swallowed deliberately — see comment above. Nothing actionable for the caller to do.
    }
    this.listeners.forEach((listener) => listener(this.game.state))
  }
}
