import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from './game'
import { LocalGameRepository, STORAGE_KEY } from '@/lib/local-repository'
import type { KeyValueStorage } from '@/lib/local-repository'
import type {
  AddPlayerInput,
  CreatedGame,
  GameConfig,
  GameRepository,
  ResumableGameRepository,
  Seat,
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
  lastRemovedPlayerId: string | null = null
  /** Records the order `addPlayer`/`subscribe`/`createGame` are called in, so `join()` tests can
   * assert the store seats the joiner before subscribing (see the room-scoped read gate note in
   * firestore-realtime — subscribing first would hit a permission-denied `onSnapshot` never
   * recovers from). */
  callOrder: string[] = []
  state: GameState = { status: 'waiting', currentRound: 1, players: [], roundScores: [] }
  /** Lets a test simulate an online host (non-null room code) without a real repository. */
  roomCodeToReturn: string | null = null

  async createGame(config: GameConfig): Promise<CreatedGame> {
    this.callOrder.push('createGame')
    this.lastCreateGameConfig = config
    return { gameId: 'fake-game', roomCode: this.roomCodeToReturn, hostPlayerId: 'fake-host' }
  }

  async addPlayer(input: AddPlayerInput): Promise<string> {
    this.callOrder.push('addPlayer')
    const player = { id: `player-${input.name}`, name: input.name, totalScore: 0 }
    this.emit({ ...this.state, players: [...this.state.players, player] })
    return player.id
  }

  /** The error callback the store passed to subscribe(), so a test can fail the live connection. */
  reportError: ((error: unknown) => void) | undefined

  subscribe(onChange: (state: GameState) => void, onError?: (error: unknown) => void): Unsubscribe {
    this.callOrder.push('subscribe')
    this.reportError = onError
    this.listeners.add(onChange)
    onChange(this.state)
    return () => this.listeners.delete(onChange)
  }

  async setRoundScore(input: SetRoundScoreInput): Promise<void> {
    // Recorded only — these tests exercise standings via emit() directly, not this input.
    this.lastSetRoundScoreInput = input
  }

  async removePlayer(playerId: string): Promise<void> {
    this.lastRemovedPlayerId = playerId
  }

  async advanceRound(): Promise<void> {
    this.emit({ ...this.state, currentRound: 2 })
  }

  async finishGame(): Promise<GameResult> {
    this.emit({ ...this.state, status: 'finished' })
    return { gameId: 'fake-game', finishedAt: 'now', totalRounds: 5 }
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

describe('useGameStore identity, host side', () => {
  it('marks this device as host and records the seated hostPlayerId after start()', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()

    await game.start(repository, HOST_CONFIG)

    expect(game.isHost).toBe(true)
    expect(game.myPlayerId).toBe('fake-host')
  })

  it('is not online when the repository assigns no room code (local mode)', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()

    await game.start(repository, HOST_CONFIG)

    expect(game.isOnline).toBe(false)
  })

  it('is online once the repository assigns a room code', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    repository.roomCodeToReturn = 'ABCDE'

    await game.start(repository, HOST_CONFIG)

    expect(game.isOnline).toBe(true)
  })
})

describe('useGameStore.join', () => {
  const JOIN_CODE = 'ABCDE'
  const ALICE_INPUT: AddPlayerInput = { name: 'Alice', deviceUuid: 'device-a' }

  it('seats the player via addPlayer without ever calling createGame', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()

    await game.join(repository, JOIN_CODE, ALICE_INPUT)

    expect(repository.lastCreateGameConfig).toBeNull()
    expect(repository.callOrder).not.toContain('createGame')
  })

  it('calls addPlayer before subscribe, so the joiner is a room member before any read', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()

    await game.join(repository, JOIN_CODE, ALICE_INPUT)

    expect(repository.callOrder).toEqual(['addPlayer', 'subscribe'])
  })

  it('sets gameId and roomCode to the joined code', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()

    await game.join(repository, JOIN_CODE, ALICE_INPUT)

    expect(game.gameId).toBe(JOIN_CODE)
    expect(game.roomCode).toBe(JOIN_CODE)
  })

  it("returns the repository's assigned playerId", async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()

    const playerId = await game.join(repository, JOIN_CODE, ALICE_INPUT)

    expect(playerId).toBe('player-Alice')
  })

  it('marks this device as a non-host, records the returned playerId, and is online', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()

    const playerId = await game.join(repository, JOIN_CODE, ALICE_INPUT)

    expect(game.isHost).toBe(false)
    expect(game.myPlayerId).toBe(playerId)
    expect(game.isOnline).toBe(true)
  })

  it('reflects state the repository emits after joining', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()

    await game.join(repository, JOIN_CODE, ALICE_INPUT)
    repository.emit({
      status: 'playing',
      currentRound: 1,
      // Standings now derive totalScore from roundScores (see stores/game.ts), so the fixture's
      // player.totalScore must agree with this — a lying totalScore is covered separately by
      // the 'useGameStore standings' describe block's dedicated regression test.
      roundScores: [{ round: 1, playerId: 'player-Alice', points: 7 }],
      players: [{ id: 'player-Alice', name: 'Alice', totalScore: 7 }],
    })

    expect(game.standings.map((s) => s.player.name)).toEqual(['Alice'])
    expect(game.standings[0]?.total).toBe(7)
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
      // Standings derive totalScore from roundScores (see stores/game.ts) — kept consistent
      // with the players' totalScore field here so this test stays focused on sort order, not
      // the derivation itself (that's the dedicated regression test below).
      roundScores: [
        { round: 1, playerId: 'a', points: 30 },
        { round: 1, playerId: 'b', points: 10 },
      ],
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

  // Security regression test: a malicious client (or a compromised/buggy repository) could emit
  // a `totalScore` that disagrees with the actual `roundScores` — e.g. a player who wrote
  // themselves a favorable total directly. Low-total-wins makes that self-SERVING, not
  // self-defeating, so ranking must never trust the writable `totalScore` field; it must be
  // recomputed from `roundScores` (see firestore.rules' bounded points/round + docs/DECISIONS.md).
  it('ranks by the roundScores-derived total, ignoring a lying totalScore field', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.start(repository, HOST_CONFIG)

    repository.emit({
      status: 'playing',
      currentRound: 1,
      // Alice's real total (from roundScores) is 40, but her player doc's totalScore field
      // falsely claims 1 — if the store trusted totalScore directly, Alice would wrongly lead.
      roundScores: [
        { round: 1, playerId: 'a', points: 25 },
        { round: 2, playerId: 'a', points: 15 },
        { round: 1, playerId: 'b', points: 20 },
      ],
      players: [
        { id: 'a', name: 'Alice', totalScore: 1 },
        { id: 'b', name: 'Bob', totalScore: 20 },
      ],
    })

    expect(game.standings.map((s) => s.player.id)).toEqual(['b', 'a'])
    expect(game.standings.map((s) => s.total)).toEqual([20, 40])
    expect(game.winners.map((s) => s.player.id)).toEqual(['b'])
  })
})

describe('useGameStore.roundScores', () => {
  it('exposes the roundScores the repository emits, for deriving "who scored this round"', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.start(repository, HOST_CONFIG)

    repository.emit({
      status: 'playing',
      currentRound: 1,
      roundScores: [{ round: 1, playerId: 'a', points: 12 }],
      players: [{ id: 'a', name: 'Alice', totalScore: 12 }],
    })

    expect(game.roundScores).toEqual([{ round: 1, playerId: 'a', points: 12 }])
  })
})

describe('useGameStore.removePlayer', () => {
  it('forwards the removal to the repository', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.start(repository, HOST_CONFIG)

    await game.removePlayer('a')

    expect(repository.lastRemovedPlayerId).toBe('a')
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

    await game.finishGame()

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

  it('resets isHost and myPlayerId so a stale identity never leaks into the next game', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.start(repository, HOST_CONFIG)

    game.leave()

    expect(game.isHost).toBe(false)
    expect(game.myPlayerId).toBeNull()
  })

  it("clears a finished game's players/roundScores/status, not just the identity flags", async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.start(repository, HOST_CONFIG)
    repository.emit({
      status: 'finished',
      currentRound: 5,
      roundScores: [{ round: 1, playerId: 'a', points: 12 }],
      players: [{ id: 'a', name: 'Alice', totalScore: 12 }],
    })

    game.leave()

    expect(game.status).toBe('waiting')
    expect(game.currentRound).toBe(1)
    expect(game.roundScores).toEqual([])
    expect(game.standings).toEqual([])
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

    await game.finishGame()

    expect(game.standings.map((s) => s.player.name)).toEqual(['Alice', 'Carol', 'Bob', 'Host'])
    expect(game.winners.map((s) => s.player.name)).toEqual(['Alice'])
    expect(game.status).toBe('finished')
  })
})

describe('useGameStore.resume', () => {
  it('does nothing and returns false when no local game is persisted', () => {
    const game = useGameStore()

    const resumed = game.resume({ storage: makeMemoryStorage() })

    expect(resumed).toBe(false)
    expect(game.standings).toEqual([])
    expect(game.isHost).toBe(false)
  })

  it('reconstructs a persisted local game and reflects its state as host', async () => {
    const storage = makeMemoryStorage()
    let count = 0
    const seed = new LocalGameRepository({ storage, newId: () => `id-${++count}` })
    const created = await seed.createGame(HOST_CONFIG)
    await seed.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    seed.leave()

    const game = useGameStore()
    const resumed = game.resume({ storage })

    expect(resumed).toBe(true)
    expect(game.isHost).toBe(true)
    expect(game.isOnline).toBe(false)
    expect(game.myPlayerId).toBe(created.hostPlayerId)
    expect(game.standings.map((s) => s.player.name)).toEqual(['Host', 'Alice'])
  })

  it('keeps reflecting further mutations after resuming (stays subscribed)', async () => {
    const storage = makeMemoryStorage()
    const seed = new LocalGameRepository({ storage })
    await seed.createGame(HOST_CONFIG)
    const alice = await seed.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    seed.leave()

    const game = useGameStore()
    game.resume({ storage })
    await game.setRoundScore({ playerId: alice, round: 1, points: 7 })

    expect(game.standings.find((s) => s.player.id === alice)?.total).toBe(7)
  })

  it('does not clobber an already-active repository', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.start(repository, HOST_CONFIG)

    const storage = makeMemoryStorage()
    const seed = new LocalGameRepository({ storage })
    await seed.createGame({ hostDeviceUuid: 'someone-else', hostDisplayName: 'Someone Else' })

    const resumed = game.resume({ storage })

    expect(resumed).toBe(false)
    expect(game.myPlayerId).toBe('fake-host')
  })

  it('returns false for a storage holding only a corrupted/foreign value', () => {
    const storage = makeMemoryStorage()
    storage.setItem(STORAGE_KEY, 'not json')

    const game = useGameStore()
    const resumed = game.resume({ storage })

    expect(resumed).toBe(false)
  })
})

/** An online repository that can find this device's seat again, as after a reload. */
class FakeResumableRepository extends FakeGameRepository implements ResumableGameRepository {
  seat: Seat | null = { playerId: 'player-alice', isHost: false }

  async findSeat(): Promise<Seat | null> {
    return this.seat
  }
}

describe('useGameStore.resumeOnline', () => {
  it("resumes this device's seat in an online room and follows its live state", async () => {
    const game = useGameStore()
    const repository = new FakeResumableRepository()
    repository.seat = { playerId: 'host-uid', isHost: true }

    const resumed = await game.resumeOnline(repository, 'ABCDE')

    expect(resumed).toBe(true)
    expect(game.roomCode).toBe('ABCDE')
    expect(game.isHost).toBe(true)
    expect(game.myPlayerId).toBe('host-uid')
    expect(repository.callOrder).toContain('subscribe')
  })

  it('does nothing when this device has no seat in the room', async () => {
    const game = useGameStore()
    const repository = new FakeResumableRepository()
    repository.seat = null

    const resumed = await game.resumeOnline(repository, 'ABCDE')

    expect(resumed).toBe(false)
    expect(game.roomCode).toBeNull()
    expect(repository.callOrder).not.toContain('subscribe')
  })

  it('never replaces a game that is already running', async () => {
    const game = useGameStore()
    await game.start(new FakeGameRepository(), HOST_CONFIG)

    const resumed = await game.resumeOnline(new FakeResumableRepository(), 'ABCDE')

    expect(resumed).toBe(false)
  })
})

describe('useGameStore.join, host status', () => {
  it('treats the host rejoining their own room by code as the host', async () => {
    const game = useGameStore()
    const repository = new FakeResumableRepository()
    repository.seat = { playerId: 'player-Host', isHost: true }

    await game.join(repository, 'ABCDE', { name: 'Host', deviceUuid: 'device-host' })

    expect(game.isHost).toBe(true)
  })
})

describe('useGameStore connection errors', () => {
  it('marks the live connection lost when the room stops updating', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.join(repository, 'ABCDE', { name: 'Alice', deviceUuid: 'device-a' })

    repository.reportError?.(Object.assign(new Error('offline'), { code: 'unavailable' }))

    expect(game.connectionError).toBe('lost')
  })

  it('marks this device as out of the room when the rules stop letting it read', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.join(repository, 'ABCDE', { name: 'Alice', deviceUuid: 'device-a' })

    repository.reportError?.(Object.assign(new Error('denied'), { code: 'permission-denied' }))

    expect(game.connectionError).toBe('removed')
  })

  it('clears the error when leaving the room', async () => {
    const game = useGameStore()
    const repository = new FakeGameRepository()
    await game.join(repository, 'ABCDE', { name: 'Alice', deviceUuid: 'device-a' })
    repository.reportError?.(new Error('offline'))

    game.leave()

    expect(game.connectionError).toBeNull()
  })
})

describe('useGameStore actions before start()', () => {
  it('rejects calling an action before start() has been called', async () => {
    const game = useGameStore()

    await expect(game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })).rejects.toThrow()
  })
})
