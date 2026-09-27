/**
 * LocalGameRepository — offline, single-device GameRepository. In-memory GameState
 * persisted to localStorage so a page reload resumes the same game. No network;
 * `roomCode` is always null. `subscribe` re-emits the full state to a new listener
 * immediately, and to every listener again on each mutation.
 *
 * `finishGame` also queues the permanent stats record (a `GameResult` plus the HOST's own single
 * `GamePlayer` row only — see `buildHostGamePlayer`'s doc comment for why not the local
 * co-players' too, see docs/PLAN.md "Stats & history") into the pending-results localStorage
 * queue — there is no network here, so they can't be written to Firestore directly;
 * `pending-results.ts`'s `flushPendingResults` uploads them once the app is next online (see
 * docs/DECISIONS.md's "Reconnect = push final result only").
 */
import { TOTAL_ROUNDS, contractForRound, placements as placementsFor, runningTotal } from './rules'
import { bestAndWorstRound } from './stats'
import { appendPendingResult } from './pending-results'
import { browserLocalStorage } from './key-value-storage'
import type { KeyValueStorage } from './key-value-storage'
import type { GamePlayer, GameResult, GameState, Player, RoundScore } from './types'
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
  /** The host's seated playerId — kept alongside (not inside) GameState, so a resumed repository
   * can report it back to the game store (see `getResumeInfo`) without `createGame()` having run
   * in this process. */
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

// Re-exported so existing call sites (`stores/game.ts`, this file's own tests) keep importing it
// from here — the interface itself now lives in `key-value-storage.ts`, shared with
// `pending-results.ts` (see that file's doc comment on why it was extracted).
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

/** Guards the localStorage boundary: untrusted `unknown` in, a real `StoredGame` or nothing. A
 * schema change, a partial write, or foreign data under our key must never crash the offline
 * host — it must just look like "no saved game" and start fresh. */
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

/**
 * True when `storage` holds a local game that has actually been started (`createGame()` called at
 * least once) — used to decide whether to resume on mount rather than show the empty state (see
 * `stores/game.ts`'s `resume()` and RoomView). Reading a "no persisted game" / corrupted value the
 * same way `readStoredGame` does means this never throws either.
 */
export function hasPersistedGame(storage: KeyValueStorage = browserLocalStorage()): boolean {
  const stored = readStoredGame(storage)
  return stored !== null && stored.gameId !== ''
}

/** True when `storage` holds a local game that was started and isn't finished: the one Home
 * offers to continue, and the one a new local game would replace. */
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
    const hostPlayer: Player = { id: hostPlayerId, name: config.hostDisplayName, totalScore: 0 }
    this.game = {
      gameId,
      hostDeviceUuid: config.hostDeviceUuid,
      hostPlayerId,
      state: { ...initialGameState(), players: [hostPlayer] },
    }
    this.persistAndNotify()
    return { gameId, roomCode: null, hostPlayerId }
  }

  /**
   * The identifying bits `stores/game.ts`'s `resume()` needs to reconstruct the store's identity
   * flags (`myPlayerId`, `isHost`) that normally come back from `createGame()`'s `CreatedGame` —
   * resuming (a fresh repository instance reading an existing `StoredGame` from storage, not a
   * fresh `createGame()` call) has no such return value to draw from otherwise. `null` when
   * nothing has been persisted yet (mirrors `hasPersistedGame`).
   */
  getResumeInfo(): { gameId: GameId; hostPlayerId: PlayerId } | null {
    if (!this.game.gameId) return null
    return { gameId: this.game.gameId, hostPlayerId: this.game.hostPlayerId }
  }

  async addPlayer(input: AddPlayerInput): Promise<PlayerId> {
    const playerId = this.newId()
    this.game = {
      ...this.game,
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

    const result: GameResult = {
      gameId: this.game.gameId,
      finishedAt: this.now(),
      totalRounds: TOTAL_ROUNDS,
    }

    // No network here (offline by construction): queue the permanent record for the reconnect
    // flush (see pending-results.ts) instead of writing it anywhere now. Best-effort, same as
    // persistAndNotify above — a queueing failure must not fail the game the player just finished.
    appendPendingResult(this.storage, { result, players: [this.buildHostGamePlayer()] })

    return result
  }

  leave(): void {
    this.listeners.clear()
  }

  /**
   * Builds the ONE permanent `GamePlayer` row `finishGame` queues: the host's own — never the
   * local ad-hoc co-players'. Two independent reasons this is correct, not a shortcut:
   *
   * 1. Locked decision (docs/DECISIONS.md "Stats identity keying"): local co-players get a fresh
   *    synthetic per-game UUID, so their stats never aggregate across games anyway — a permanent
   *    Firestore row for them would never be useful.
   * 2. Security (docs/DECISIONS.md's forgery-fix entry): `firestore.rules`' local-path
   *    (no-room) `game_player` create rule requires `deviceUuid == request.auth.uid` — a
   *    self-write only. The reconnect flush (`reconnect-flush.ts`) stamps this row's `deviceUuid`
   *    with whoever is actually signed in at flush time; queuing a co-player's row here would
   *    just be queued data that could never pass that rule under anyone's auth session.
   *
   * `finalScore` is recomputed from `roundScores` (not the possibly-stale `totalScore` field) the
   * same way the game store's `rankedPlayers` does, for the same reason: a written stats row is
   * worth getting exactly right.
   */
  private buildHostGamePlayer(): GamePlayer {
    const { roundScores, players } = this.game.state
    const hostStanding = placementsFor(players).find(
      (standing) => standing.player.id === this.game.hostPlayerId,
    )
    if (!hostStanding) {
      throw new Error('finishGame: host player not found among seated players')
    }
    const { player: host, placement } = hostStanding

    const points = roundScores
      .filter((score) => score.playerId === host.id)
      .map((score) => score.points)
    // Trusts the same finishGame precondition as above — the host should have a score for every
    // round reached — but never crashes on the edge case (no recorded rounds) rather than let
    // bestAndWorstRound's empty-input throw surface here.
    const { bestRound, worstRound } =
      points.length > 0 ? bestAndWorstRound(points) : { bestRound: 0, worstRound: 0 }

    return {
      gameId: this.game.gameId,
      deviceUuid: this.game.hostDeviceUuid,
      displayName: host.name,
      finalScore: runningTotal(host.id, roundScores),
      placement,
      bestRound,
      worstRound,
    }
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
