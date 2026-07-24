/**
 * The game/room setup store. Orchestrates over a `GameRepository` — never Firestore, never
 * `LocalGameRepository` directly — so this file is identical whether the caller injected a
 * local offline game or (slice 4) a Firestore-backed online room. See the `GameRepository`
 * seam in src/lib/repository.ts and the firestore-realtime + vue-pinia skills.
 */
import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  contractForRound,
  runningTotal,
  standings as standingsFor,
  winners as winnersFor,
} from '@/lib/rules'
import type {
  AddPlayerInput,
  GameConfig,
  GameId,
  GameRepository,
  PlayerId,
  SetRoundScoreInput,
  Unsubscribe,
} from '@/lib/repository'
import type { GameResult, GameState, Player } from '@/lib/types'

function initialGameState(): GameState {
  return { status: 'waiting', currentRound: 1, players: [], roundScores: [] }
}

export const useGameStore = defineStore('game', () => {
  const state = ref<GameState>(initialGameState())
  const gameId = ref<GameId | null>(null)
  const roomCode = ref<string | null>(null)

  // Not `ref`s: the repository/unsubscribe handles are I/O plumbing, not state to render.
  // Injected by `start()` — this is the seam. Tests pass a fake or a LocalGameRepository;
  // slice 4 passes a FirestoreGameRepository. The store never imports a concrete repository.
  let repository: GameRepository | null = null
  let unsubscribe: Unsubscribe | null = null

  const status = computed(() => state.value.status)
  const currentRound = computed(() => state.value.currentRound)
  const currentContract = computed(() => contractForRound(state.value.currentRound))

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
  const winners = computed(() => winnersFor(rankedPlayers.value))

  function requireRepository(): GameRepository {
    if (!repository) {
      throw new Error('game store: call start() before interacting with the game')
    }
    return repository
  }

  /** Starts a new game against the given repository and begins reflecting its live state. */
  async function start(repo: GameRepository, config: GameConfig): Promise<void> {
    leave()
    repository = repo
    const created = await repo.createGame(config)
    gameId.value = created.gameId
    roomCode.value = created.roomCode
    unsubscribe = repo.subscribe((next) => {
      state.value = next
    })
  }

  /**
   * Joins an existing online game by room code: seats `player` as a new player, then begins
   * reflecting the room's live state — never calling `createGame` (the host already did that;
   * see `start`). Order matters: `addPlayer` must resolve *before* `subscribe` is called. The
   * room-scoped read gate in firestore.rules only lets already-seated members read the
   * players/roundScores subcollections, so subscribing first would hit a permission-denied that
   * `onSnapshot` never recovers from, even after the join completes (see firestore-realtime).
   */
  async function join(
    repo: GameRepository,
    code: string,
    player: AddPlayerInput,
  ): Promise<PlayerId> {
    leave()
    repository = repo
    gameId.value = code
    roomCode.value = code
    const playerId = await repo.addPlayer(player)
    unsubscribe = repo.subscribe((next) => {
      state.value = next
    })
    return playerId
  }

  async function addPlayer(input: AddPlayerInput): Promise<PlayerId> {
    return requireRepository().addPlayer(input)
  }

  async function setRoundScore(input: SetRoundScoreInput): Promise<void> {
    await requireRepository().setRoundScore(input)
  }

  async function advanceRound(): Promise<void> {
    await requireRepository().advanceRound()
  }

  async function finishGame(): Promise<GameResult> {
    return requireRepository().finishGame()
  }

  /** Tears down the subscription and the repository's own resources. Safe to call repeatedly. */
  function leave(): void {
    unsubscribe?.()
    unsubscribe = null
    repository?.leave()
    repository = null
  }

  onScopeDispose(leave)

  return {
    gameId,
    roomCode,
    status,
    currentRound,
    currentContract,
    standings,
    winners,
    start,
    join,
    addPlayer,
    setRoundScore,
    advanceRound,
    finishGame,
    leave,
  }
})
