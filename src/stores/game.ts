/**
 * The game store. It talks only to a `GameRepository`, so local and online games run the same
 * code. The one exception is `resume()`, which is local-only by definition and so builds a
 * `LocalGameRepository` itself.
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
  /** This device hosts the game: it created it, or rejoined as its host. */
  const isHost = ref(false)
  /** The seat this device plays in. */
  const myPlayerId = ref<PlayerId | null>(null)

  // Not refs: I/O handles, nothing to render.
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
  /** Only an online repository returns a room code, so this means "a live multi-device room". */
  const isOnline = computed(() => roomCode.value !== null)

  /** Totals recomputed from `roundScores`, never the writable `totalScore` field: the rules can't
   * verify a sum, and with the low total winning, a faked total would pay off. */
  const rankedPlayers = computed<Player[]>(() =>
    state.value.players.map((player) => ({
      ...player,
      totalScore: runningTotal(player.id, state.value.roundScores),
    })),
  )
  const standings = computed(() => standingsFor(rankedPlayers.value))
  /** What the scoreboard shows: numbers only for revealed rounds. `standings` stays the full
   * live ranking, for seat order, the Next gate and the winner. */
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

  /** Starts a new game as its host. */
  /** A game that can't be created changes nothing: the current one stays. */
  async function start(repo: GameRepository, config: GameConfig): Promise<void> {
    const created = await repo.createGame(config)
    leave()
    hostCreatedGame(repo, created)
  }

  /**
   * Starts the next game with the same players while the finished one stays on screen. Online,
   * the finished room links to the next one first: the rules only let the host seat players in
   * the room it points at. A failed create changes nothing, so the host can retry.
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
        // A refused link (an expired room) doesn't stop the next game: its code is on screen.
        await finished.linkNextRoom(created.roomCode).catch(() => undefined)
      }
      // Nor a failed carry: the link is set once, so a retry would point the others at a room
      // the host isn't in. Their phones still offer "Join the next game".
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
   * Joins an online room by code. `addPlayer` must resolve before `subscribe`: the rules only let
   * seated players read the room, and a refused `onSnapshot` never recovers. The current game is
   * left only once the seat is taken, so a refused join changes nothing.
   */
  async function join(
    repo: GameRepository,
    code: string,
    player: AddPlayerInput,
  ): Promise<PlayerId> {
    const playerId = await repo.addPlayer(player)
    // Before anything changes here: a lookup that fails leaves the current game on screen, and a
    // retry finds the seat already taken. The host rejoining their own room is still its host.
    const seat = isResumable(repo) ? await repo.findSeat() : null
    leave()
    repository = repo
    gameId.value = code
    roomCode.value = code
    isHost.value = seat?.isHost ?? false
    myPlayerId.value = playerId
    rememberRoom(code)
    followRoom(repo)
    return playerId
  }

  /** Resumes this device's online seat after a reload. False when busy or not seated there. */
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

  /** Resumes the saved local game after a reload. False when busy or nothing is saved. */
  function resume(deps: { storage?: KeyValueStorage } = {}): boolean {
    if (repository) return false
    if (!hasPersistedGame(deps.storage)) return false

    const repo = new LocalGameRepository({ storage: deps.storage })
    const resumed = repo.getResumeInfo()
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

  /** Tears everything down, state included, so a finished game never lingers. Safe to repeat. */
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
