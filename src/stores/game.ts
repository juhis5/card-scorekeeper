/**
 * The game/room setup store. Orchestrates over a `GameRepository` — never Firestore, never
 * `LocalGameRepository` directly — so this file is identical whether the caller injected a
 * local offline game or (slice 4) a Firestore-backed online room. See the `GameRepository`
 * seam in src/lib/repository.ts and the firestore-realtime + vue-pinia skills.
 *
 * `resume()` (slice 5, offline robustness) is the one deliberate exception to "never
 * `LocalGameRepository` directly": resuming a persisted game after a reload is local-only by
 * definition (an online room is Firestore-backed and reconnects there, not resumed here — see
 * docs/DECISIONS.md's slice-5 entries), so there is no online counterpart this needs to stay
 * identical to, unlike `start`/`join`.
 */
import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  completedRounds as completedRoundsFor,
  contractForRound,
  runningTotal,
  standings as standingsFor,
  winners as winnersFor,
} from '@/lib/game/rules'
import { hasPersistedGame, LocalGameRepository } from '@/lib/data/local-repository'
import { forgetRoom, rememberRoom } from '@/lib/data/last-room'
import { boardRows } from '@/lib/game/scoreboard'
import type { KeyValueStorage } from '@/lib/data/local-repository'
import type {
  AddGuestInput,
  AddPlayerInput,
  CreatedGame,
  GameConfig,
  GameId,
  GameRepository,
  PlayerId,
  ResumableGameRepository,
  SetRoundScoreInput,
  Unsubscribe,
} from '@/lib/data/repository'
import { isReplayable, isResumable } from '@/lib/data/repository'
import { isPermissionDenied } from '@/lib/data/write-errors'
import type { GameResult, GameState, Player } from '@/lib/game/types'

function initialGameState(): GameState {
  return { status: 'waiting', currentRound: 1, players: [], roundScores: [] }
}

export const useGameStore = defineStore('game', () => {
  const state = ref<GameState>(initialGameState())
  const gameId = ref<GameId | null>(null)
  const roomCode = ref<string | null>(null)
  /** True on this device after `start()` (it created the game); false after `join()`. Gates
   * host-only actions (advance round / finish) in the UI — see RoomView. */
  const isHost = ref(false)
  /** The playerId THIS device is seated as — the host's seat after `start()`, the joiner's own
   * seat after `join()`. Lets the UI show only this device's own editable score row online. */
  const myPlayerId = ref<PlayerId | null>(null)

  // Not `ref`s: the repository/unsubscribe handles are I/O plumbing, not state to render.
  // Injected by `start()` — this is the seam. Tests pass a fake or a LocalGameRepository;
  // slice 4 passes a FirestoreGameRepository. The store never imports a concrete repository.
  let repository: GameRepository | null = null
  let unsubscribe: Unsubscribe | null = null
  /** Why the live room stopped updating: 'removed' when the rules stopped letting this device
   * read (its seat was removed, or the room closed), 'lost' for anything else. */
  const connectionError = ref<'removed' | 'lost' | null>(null)

  function followRoom(repo: GameRepository): void {
    connectionError.value = null
    unsubscribe = repo.subscribe(
      (next) => {
        state.value = next
        // Nothing left to continue: Home stops offering this room.
        if (next.status === 'finished' && roomCode.value) forgetRoom(roomCode.value)
      },
      (error) => {
        connectionError.value = isPermissionDenied(error) ? 'removed' : 'lost'
        if (connectionError.value === 'removed' && roomCode.value) forgetRoom(roomCode.value)
      },
    )
  }

  const status = computed(() => state.value.status)
  const currentRound = computed(() => state.value.currentRound)
  const currentContract = computed(() => contractForRound(state.value.currentRound))
  const completedRounds = computed(() =>
    completedRoundsFor(state.value.currentRound, state.value.status),
  )
  const roundScores = computed(() => state.value.roundScores)
  /** A non-null room code only ever comes from an online (Firestore) repository — local mode's
   * `CreatedGame.roomCode` is always null (see repository.ts) — so this doubles as "is this a
   * live multi-device room" without the store importing a concrete repository to ask. */
  const isOnline = computed(() => roomCode.value !== null)

  /**
   * Players with `totalScore` RECOMPUTED from `state.roundScores`, never the writable field a
   * repository/document reports. Low-total-wins makes a falsified `totalScore` self-SERVING
   * (not "self-defeating" — see docs/DECISIONS.md), and Firestore rules bound `points`/`round`
   * but can't sum a player's own docs into a trustworthy total — so ranking derives it here
   * instead of trusting the field. Both repositories already emit `roundScores`, so this covers
   * local and online alike.
   */
  const rankedPlayers = computed<Player[]>(() =>
    state.value.players.map((player) => ({
      ...player,
      totalScore: runningTotal(player.id, state.value.roundScores),
    })),
  )
  const standings = computed(() => standingsFor(rankedPlayers.value))
  /** What the scoreboard shows: numbers only for revealed rounds (see lib/scoreboard.ts).
   * `standings` stays the full live ranking, for seat order, the Next gate and the winner. */
  const board = computed(() =>
    boardRows(state.value.players, state.value.roundScores, completedRounds.value),
  )
  const winners = computed(() => winnersFor(rankedPlayers.value))
  /** Set once the host of this finished online game started the next one (Play again). */
  const nextRoomCode = computed(() => state.value.nextRoomCode ?? null)
  /** This device already has a seat in that next room: the host brought everyone along. */
  const hasSeatInNextRoom = computed(() => state.value.hasSeatInNextRoom === true)

  function requireRepository(): GameRepository {
    if (!repository) {
      throw new Error('game store: call start() before interacting with the game')
    }
    return repository
  }

  /** Makes this device the host of the game `repo` just created, and follows it. */
  function hostCreatedGame(repo: GameRepository, created: CreatedGame): void {
    repository = repo
    gameId.value = created.gameId
    roomCode.value = created.roomCode
    isHost.value = true
    myPlayerId.value = created.hostPlayerId
    if (created.roomCode) rememberRoom(created.roomCode)
    followRoom(repo)
  }

  /** Starts a new game against the given repository and begins reflecting its live state. */
  async function start(repo: GameRepository, config: GameConfig): Promise<void> {
    leave()
    repository = repo
    hostCreatedGame(repo, await repo.createGame(config))
  }

  /**
   * Play again: starts the next game with the same players while the finished one stays on
   * screen, then follows it as its host. A failed create changes nothing, so the host can retry.
   *
   * Online, the next room is linked from the finished one first, then everyone is seated there
   * as they were (the rules only let the host seat them in the room the finished one points at),
   * and each phone moves over once it sees its seat. Locally, `otherNames` are seated again.
   */
  async function playAgain(
    nextRepo: GameRepository,
    config: GameConfig,
    otherNames: readonly string[] = [],
  ): Promise<void> {
    const finished = requireRepository()
    const finishedRoomCode = roomCode.value
    if (finishedRoomCode && isReplayable(finished) && isReplayable(nextRepo)) {
      const created = await nextRepo.createNextGame(config, finishedRoomCode)
      if (created.roomCode) {
        // The next game goes ahead even when the link doesn't land: an expired room refuses it,
        // and the next room's code is on screen to share instead. Guests still come along.
        await finished.linkNextRoom(created.roomCode).catch(() => undefined)
      }
      // Nor when bringing the others fails: the link is set once, so a retry would point the
      // others at a room the host isn't in. Their phones still have "Join the next game".
      await nextRepo.carrySeats().catch(() => undefined)
      leave()
      hostCreatedGame(nextRepo, created)
      return
    }
    const created = await nextRepo.createGame(config)
    for (const name of otherNames) await nextRepo.addGuest({ name })
    leave()
    hostCreatedGame(nextRepo, created)
  }

  /**
   * Joins an existing online game by room code: seats `player` as a new player, then begins
   * reflecting the room's live state — never calling `createGame` (the host already did that;
   * see `start`). Order matters: `addPlayer` must resolve *before* `subscribe` is called. The
   * room-scoped read gate in firestore.rules only lets already-seated members read the
   * players/roundScores subcollections, so subscribing first would hit a permission-denied that
   * `onSnapshot` never recovers from, even after the join completes (see firestore-realtime).
   *
   * The current game, if any, is left only once the seat is taken: a refused seat changes nothing
   * here, so a player joining the next game from a finished one still sees it, and Home never
   * offers to continue a room this device never got into.
   */
  async function join(
    repo: GameRepository,
    code: string,
    player: AddPlayerInput,
  ): Promise<PlayerId> {
    const playerId = await repo.addPlayer(player)
    leave()
    repository = repo
    gameId.value = code
    roomCode.value = code
    isHost.value = false
    myPlayerId.value = playerId
    rememberRoom(code)
    // The host rejoining their own room by code is still its host.
    if (isResumable(repo)) isHost.value = (await repo.findSeat())?.isHost ?? false
    followRoom(repo)
    return playerId
  }

  /**
   * Resumes this device's seat in an online room after a reload: the room code comes from the
   * URL, the seat and host status from the room itself. Returns false, leaving the store idle,
   * when a game is already running or this device has no seat there.
   */
  async function resumeOnline(repo: ResumableGameRepository, code: string): Promise<boolean> {
    if (repository) return false
    const seat = await repo.findSeat()
    if (!seat || repository) return false
    repository = repo
    gameId.value = code
    roomCode.value = code
    isHost.value = seat.isHost
    myPlayerId.value = seat.playerId
    followRoom(repo)
    return true
  }

  /**
   * Resumes an already-persisted LOCAL game after a hard reload — mirrors `start()`'s wiring
   * (records identity, subscribes) but skips `createGame()`: the repository's storage already has
   * a game, `getResumeInfo()` reads back the identity `createGame()` would otherwise have
   * returned. No-ops (returns `false`) when a repository is already active — never clobber a
   * running game — or when nothing is persisted. `deps.storage` lets tests inject a fake instead
   * of real `localStorage` (see the tdd skill); RoomView calls this with no args in production.
   */
  function resume(deps: { storage?: KeyValueStorage } = {}): boolean {
    if (repository) return false
    if (!hasPersistedGame(deps.storage)) return false

    const repo = new LocalGameRepository({ storage: deps.storage })
    const resumed = repo.getResumeInfo()
    // Belt-and-suspenders: storage could in principle change between the hasPersistedGame()
    // check above and this read. Never expected in practice (single-threaded, no await between
    // them), but falling through to "nothing to resume" is always safe.
    if (!resumed) return false

    repository = repo
    gameId.value = resumed.gameId
    roomCode.value = null
    isHost.value = true
    myPlayerId.value = resumed.hostPlayerId
    followRoom(repo)
    return true
  }

  async function addPlayer(input: AddPlayerInput): Promise<PlayerId> {
    return requireRepository().addPlayer(input)
  }

  /** Host only: a player without a phone, whose scores the host enters. */
  async function addGuest(input: AddGuestInput): Promise<PlayerId> {
    return requireRepository().addGuest(input)
  }

  async function setRoundScore(input: SetRoundScoreInput): Promise<void> {
    await requireRepository().setRoundScore(input)
  }

  async function removePlayer(playerId: PlayerId): Promise<void> {
    await requireRepository().removePlayer(playerId)
  }

  async function advanceRound(): Promise<void> {
    await requireRepository().advanceRound()
  }

  async function finishGame(): Promise<GameResult> {
    return requireRepository().finishGame()
  }

  /** Tears down the subscription and the repository's own resources. Safe to call repeatedly.
   * Resets `state` too — not just the identity flags — so a finished game's players/roundScores/
   * status never linger in the UI after leaving, waiting for the next repository's first
   * snapshot to overwrite them (Play again moves straight from a finished game to the next). */
  function leave(): void {
    unsubscribe?.()
    unsubscribe = null
    repository?.leave()
    repository = null
    isHost.value = false
    myPlayerId.value = null
    connectionError.value = null
    state.value = initialGameState()
  }

  onScopeDispose(leave)

  return {
    gameId,
    roomCode,
    isHost,
    myPlayerId,
    isOnline,
    connectionError,
    status,
    currentRound,
    currentContract,
    completedRounds,
    roundScores,
    standings,
    board,
    winners,
    nextRoomCode,
    hasSeatInNextRoom,
    start,
    playAgain,
    join,
    resume,
    addPlayer,
    addGuest,
    setRoundScore,
    removePlayer,
    resumeOnline,
    advanceRound,
    finishGame,
    leave,
  }
})
