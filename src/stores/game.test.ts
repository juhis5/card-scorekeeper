import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from './game'
import { LocalGameRepository } from '@/lib/local-repository'
import type { KeyValueStorage } from '@/lib/local-repository'
import type {
  AddPlayerInput,
  CreatedGame,
  GameConfig,
  GameRepository,
  SetRoundScoreInput,
  Unsubscribe,
} from '@/lib/repository'
import type { ContractRoundNumber, GameResult, GameState } from '@/lib/types'

const HOST_CONFIG: GameConfig = { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' }
const ALL_ROUNDS: readonly ContractRoundNumber[] = [1, 2, 3, 4, 5]

/** A plain in-memory stand-in for localStorage — deterministic, no real browser API. */
function makeMemoryStorage(): KeyValueStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

/** Minimal hand-written fake so store tests don't depend on any concrete repository's internals. */
class FakeGameRepository implements GameRepository {
  listeners = new Set<(state: GameState) => void>()
  leaveCalls = 0
  lastCreateGameConfig: GameConfig | null = null
  lastSetRoundScoreInput: SetRoundScoreInput | null = null
  state: GameState = { status: 'waiting', currentRound: 1, players: [], roundScores: [] }

  async createGame(config: GameConfig): Promise<CreatedGame> {
    this.lastCreateGameConfig = config
    return { gameId: 'fake-game', roomCode: null }
  }

  async addPlayer(input: AddPlayerInput): Promise<string> {
    const player = { id: `player-${input.name}`, name: input.name, totalScore: 0 }
    this.emit({ ...this.state, players: [...this.state.players, player] })
    return player.id
  }

  subscribe(onChange: (state: GameState) => void): Unsubscribe {
    this.listeners.add(onChange)
    onChange(this.state)
    return () => this.listeners.delete(onChange)
  }

  async setRoundScore(input: SetRoundScoreInput): Promise<void> {
    // Recorded only — these tests exercise standings via emit() directly, not this input.
    this.lastSetRoundScoreInput = input
  }

  async advanceRound(): Promise<void> {
    this.emit({ ...this.state, currentRound: 2 })
  }

  async finishGame(): Promise<GameResult> {
    this.emit({ ...this.state, status: 'finished' })
    return { gameId: 'fake-game', finishedAt: 'now', totalRounds: 5, winnerUuid: 'device-a' }
  }

  leave(): void {
    this.leaveCalls += 1
    this.listeners.clear()
  }

  /** Test helper: pushes a new state to every current subscriber, like a real mutation would. */
  emit(next: GameState): void {
    this.state = next
    this.listeners.forEach((listener) => listener(next))
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useGameStore.start', () => {
  it('creates the game via the repository and subscribes to its state', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()

    await game.start(repository, HOST_CONFIG)

    expect(game.gameId).toBe('fake-game')
    expect(game.roomCode).toBeNull()
    expect(game.status).toBe('waiting')
  })
})

describe('useGameStore standings', () => {
  it('maps a subscribed state update to standings sorted ascending by total', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.start(repository, HOST_CONFIG)

    repository.emit({
      status: 'playing',
      currentRound: 1,
      roundScores: [],
      players: [
        { id: 'a', name: 'Alice', totalScore: 30 },
        { id: 'b', name: 'Bob', totalScore: 10 },
      ],
    })

    expect(game.standings.map((s) => s.player.id)).toEqual(['b', 'a'])
  })

  it('exposes the current round contract via lib/rules', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.start(repository, HOST_CONFIG)

    expect(game.currentContract.round).toBe(1)
    expect(game.currentContract.melds).toEqual({ setsOfThree: 2, flushes: 0 })
  })
})

describe('useGameStore.setRoundScore', () => {
  it('forwards the call to the repository and reflects the state it emits back', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.start(repository, HOST_CONFIG)

    await game.setRoundScore({ playerId: 'a', round: 1, points: 12 })
    repository.emit({
      status: 'playing',
      currentRound: 1,
      roundScores: [{ round: 1, playerId: 'a', points: 12 }],
      players: [{ id: 'a', name: 'Alice', totalScore: 12 }],
    })

    expect(game.standings[0]?.total).toBe(12)
  })
})

describe('useGameStore.advanceRound', () => {
  it('advances currentRound as the repository emits it', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.start(repository, HOST_CONFIG)

    await game.advanceRound()

    expect(game.currentRound).toBe(2)
  })
})

describe('useGameStore.finishGame', () => {
  it('declares the winner reported by the repository after the final round', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.start(repository, HOST_CONFIG)

    const result = await game.finishGame()

    expect(result.winnerUuid).toBe('device-a')
    expect(game.status).toBe('finished')
  })
})

describe('useGameStore.leave', () => {
  it('unsubscribes so no further repository emissions reach the store', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.start(repository, HOST_CONFIG)

    game.leave()
    repository.emit({
      status: 'playing',
      currentRound: 1,
      roundScores: [],
      players: [{ id: 'a', name: 'Alice', totalScore: 999 }],
    })

    expect(game.standings).toEqual([])
    expect(repository.leaveCalls).toBe(1)
  })
})

describe('useGameStore full game flow with LocalGameRepository', () => {
  it('drives a full 5-round game to the correct winner and ascending standings', async () => {
    const game = useGameStore()
    const repository = new LocalGameRepository({
      now: () => '2026-01-01T00:00:00.000Z',
      newId: (() => {
        let count = 0
        return () => `id-${++count}`
      })(),
      storage: makeMemoryStorage(),
    })

    await game.start(repository, HOST_CONFIG)
    // createGame seats the host as the first player — score them out of contention for lowest
    // total so the winner assertion below is unambiguous.
    const hostId = game.standings[0]?.player.id
    if (!hostId) throw new Error('expected the host to be seated after start()')
    const alice = await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    const bob = await game.addPlayer({ name: 'Bob', deviceUuid: 'device-b' })
    const carol = await game.addPlayer({ name: 'Carol', deviceUuid: 'device-c' })

    for (const round of ALL_ROUNDS) {
      await game.setRoundScore({ playerId: hostId, round, points: 50 })
      await game.setRoundScore({ playerId: alice, round, points: 5 })
      await game.setRoundScore({ playerId: bob, round, points: 15 })
      await game.setRoundScore({ playerId: carol, round, points: 10 })
      if (round < 5) await game.advanceRound()
    }

    const result = await game.finishGame()

    expect(result.winnerUuid).toBe('device-a')
    expect(game.standings.map((s) => s.player.name)).toEqual(['Alice', 'Carol', 'Bob', 'Host'])
    expect(game.winners.map((s) => s.player.name)).toEqual(['Alice'])
    expect(game.status).toBe('finished')
  })
})

describe('useGameStore actions before start()', () => {
  it('rejects calling an action before start() has been called', async () => {
    const game = useGameStore()

    await expect(game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })).rejects.toThrow()
  })
})
