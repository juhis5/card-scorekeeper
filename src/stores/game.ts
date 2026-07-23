/**
 * The game/room setup store. Orchestrates over a `GameRepository` — never Firestore, never
 * `LocalGameRepository` directly — so this file is identical whether the caller injected a
 * local offline game or (slice 4) a Firestore-backed online room. See the `GameRepository`
 * seam in src/lib/repository.ts and the firestore-realtime + vue-pinia skills.
 */
import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { contractForRound, standings as standingsFor, winners as winnersFor } from '@/lib/rules'
import type {
  AddPlayerInput,
  GameConfig,
  GameId,
  GameRepository,
  PlayerId,
  SetRoundScoreInput,
  Unsubscribe,
} from '@/lib/repository'
import type { GameResult, GameState } from '@/lib/types'

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
  const standings = computed(() => standingsFor(state.value.players))
  const winners = computed(() => winnersFor(state.value.players))

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
    addPlayer,
    setRoundScore,
    advanceRound,
    finishGame,
    leave,
  }
})
