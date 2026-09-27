import { describe, expect, it } from 'vitest'
import {
  hasPersistedGame,
  hasUnfinishedPersistedGame,
  LocalGameRepository,
  STORAGE_KEY,
} from './local-repository'
import type { KeyValueStorage } from './local-repository'
import { NameTakenError } from '../game/player-names'
import { readPendingResults } from './pending-results'
import type { ContractRoundNumber, GameState } from '../game/types'

const ALL_ROUNDS: readonly ContractRoundNumber[] = [1, 2, 3, 4, 5]

const HOST_CONFIG = { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' }

/** 'id-1', 'id-2', ... in call order. */
function sequentialIds(prefix: string) {
  let count = 0
  return () => `${prefix}-${++count}`
}

function makeMemoryStorage(): KeyValueStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

/** A storage whose writes always fail, like iOS Safari private mode's zero quota. */
function makeThrowingStorage(): KeyValueStorage {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
}

function makeRepository(
  overrides: { now?: () => string; newId?: () => string; storage?: KeyValueStorage } = {},
) {
  return new LocalGameRepository({
    now: overrides.now ?? (() => '2026-01-01T00:00:00.000Z'),
    newId: overrides.newId ?? sequentialIds('id'),
    storage: overrides.storage ?? makeMemoryStorage(),
  })
}

function recordEmissions(repository: LocalGameRepository): GameState[] {
  const emissions: GameState[] = []
  repository.subscribe((state) => emissions.push(state))
  return emissions
}

describe('LocalGameRepository.createGame', () => {
  it('creates a game with a null room code in local mode', async () => {
    const repository = makeRepository()

    const created = await repository.createGame(HOST_CONFIG)

    expect(created).toEqual({ gameId: 'id-1', roomCode: null, hostPlayerId: 'id-2' })
  })

  it('uses the injected id generator rather than a real UUID', async () => {
    const repository = makeRepository({ newId: () => 'fixed-game-id' })

    const created = await repository.createGame(HOST_CONFIG)

    expect(created.gameId).toBe('fixed-game-id')
  })

  it("seats the host as the game's first player, named from the config", async () => {
    const repository = makeRepository()

    await repository.createGame(HOST_CONFIG)

    const emissions = recordEmissions(repository)
    expect(emissions[0]?.players).toEqual([{ id: expect.any(String), name: 'Host', totalScore: 0 }])
  })
})

describe('LocalGameRepository.subscribe', () => {
  it('emits the current state immediately to a new subscriber', async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)

    const emissions = recordEmissions(repository)

    expect(emissions).toHaveLength(1)
    expect(emissions[0]).toMatchObject({
      status: 'waiting',
      currentRound: 1,
      players: [{ name: 'Host', totalScore: 0 }],
    })
  })

  it('re-emits the full state on every mutation', async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)
    const emissions = recordEmissions(repository)

    await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    expect(emissions).toHaveLength(2)
    expect(emissions[1]?.players.map((p) => p.name)).toEqual(['Host', 'Alice'])
  })
})

describe('LocalGameRepository.addGuest', () => {
  it('adds a player the host scores for, at any point in the game', async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)
    await repository.advanceRound()

    const playerId = await repository.addGuest({ name: ' Mummo ' })

    const emissions = recordEmissions(repository)
    expect(emissions[0]?.players).toContainEqual({ id: playerId, name: 'Mummo', totalScore: 0 })
    expect(emissions[0]?.currentRound).toBe(2)
  })

  it('refuses a name already in the game', async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)

    await expect(
      repository.addGuest({ name: HOST_CONFIG.hostDisplayName.toUpperCase() }),
    ).rejects.toBeInstanceOf(NameTakenError)
  })
})

describe('LocalGameRepository.addPlayer', () => {
  it('adds a player with a zero starting total, alongside the host', async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)

    const playerId = await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    const emissions = recordEmissions(repository)
    expect(emissions[0]?.players).toHaveLength(2)
    expect(emissions[0]?.players).toContainEqual({ id: playerId, name: 'Alice', totalScore: 0 })
  })

  it('stores the name cleaned of extra spaces', async () => {
    const repository = makeRepository()
    await repository.createGame({ ...HOST_CONFIG, hostDisplayName: '  Host ' })

    await repository.addPlayer({ name: ' Mari   Anne ', deviceUuid: 'device-m' })

    const emissions = recordEmissions(repository)
    expect(emissions[0]?.players.map((p) => p.name)).toEqual(['Host', 'Mari Anne'])
  })

  it('refuses a name already in the game, ignoring case and spaces', async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)
    await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    const error = await repository
      .addPlayer({ name: ' ALICE ', deviceUuid: 'device-a2' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(NameTakenError)
    expect(recordEmissions(repository)[0]?.players).toHaveLength(2)
  })

  it('adds multiple players in join order, after the host', async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)

    await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await repository.addPlayer({ name: 'Bob', deviceUuid: 'device-b' })

    const emissions = recordEmissions(repository)
    expect(emissions[0]?.players.map((p) => p.name)).toEqual(['Host', 'Alice', 'Bob'])
  })
})

describe('LocalGameRepository.setRoundScore', () => {
  it("records a round score and updates the player's running total", async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)
    const playerId = await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    await repository.setRoundScore({ playerId, round: 1, points: 12 })

    const emissions = recordEmissions(repository)
    const alice = emissions[0]?.players.find((p) => p.id === playerId)
    expect(alice?.totalScore).toBe(12)
    expect(emissions[0]?.status).toBe('playing')
  })

  it('sums totals across multiple rounds for the same player', async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)
    const playerId = await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    await repository.setRoundScore({ playerId, round: 1, points: 12 })
    await repository.setRoundScore({ playerId, round: 2, points: 8 })

    const emissions = recordEmissions(repository)
    const alice = emissions[0]?.players.find((p) => p.id === playerId)
    expect(alice?.totalScore).toBe(20)
  })

  it('replaces an existing score for the same player and round instead of duplicating it', async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)
    const playerId = await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    await repository.setRoundScore({ playerId, round: 1, points: 12 })
    await repository.setRoundScore({ playerId, round: 1, points: 30 })

    const emissions = recordEmissions(repository)
    expect(emissions[0]?.roundScores).toHaveLength(1)
    const alice = emissions[0]?.players.find((p) => p.id === playerId)
    expect(alice?.totalScore).toBe(30)
  })

  it("does not affect another player's total", async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)
    const alice = await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    const bob = await repository.addPlayer({ name: 'Bob', deviceUuid: 'device-b' })

    await repository.setRoundScore({ playerId: alice, round: 1, points: 12 })

    const emissions = recordEmissions(repository)
    const bobPlayer = emissions[0]?.players.find((p) => p.id === bob)
    expect(bobPlayer?.totalScore).toBe(0)
  })
})

describe('LocalGameRepository.removePlayer', () => {
  it('removes the player and every score they had', async () => {
    const repository = makeRepository()
    const { hostPlayerId } = await repository.createGame(HOST_CONFIG)
    const aliceId = await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await repository.setRoundScore({ playerId: aliceId, round: 1, points: 10 })
    await repository.setRoundScore({ playerId: hostPlayerId, round: 1, points: 20 })

    await repository.removePlayer(aliceId)

    const [state] = recordEmissions(repository)
    expect(state?.players.map((player) => player.id)).toEqual([hostPlayerId])
    expect(state?.roundScores).toEqual([{ playerId: hostPlayerId, round: 1, points: 20 }])
  })

  it("refuses to remove the host's own seat", async () => {
    const repository = makeRepository()
    const { hostPlayerId } = await repository.createGame(HOST_CONFIG)

    await expect(repository.removePlayer(hostPlayerId)).rejects.toThrow()
  })
})

describe('LocalGameRepository.advanceRound', () => {
  it('moves the current round forward one at a time, 1 through 5', async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)

    const rounds: number[] = []
    for (let step = 0; step < 4; step += 1) {
      await repository.advanceRound()
      const emissions = recordEmissions(repository)
      rounds.push(emissions[0]?.currentRound ?? -1)
    }

    expect(rounds).toEqual([2, 3, 4, 5])
  })

  it('does not advance past the final round', async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)

    for (let step = 0; step < 6; step += 1) {
      await repository.advanceRound()
    }

    const emissions = recordEmissions(repository)
    expect(emissions[0]?.currentRound).toBe(5)
  })
})

describe('LocalGameRepository.finishGame', () => {
  /** A full game the host finishes last in, so Alice wins outright. */
  async function playFullGame(storage: KeyValueStorage = makeMemoryStorage()) {
    const repository = makeRepository({ storage })
    const created = await repository.createGame(HOST_CONFIG)
    const host = recordEmissions(repository)[0]?.players[0]
    if (!host) throw new Error('expected the host to be seated after createGame')
    const alice = await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    const bob = await repository.addPlayer({ name: 'Bob', deviceUuid: 'device-b' })

    for (const round of ALL_ROUNDS) {
      await repository.setRoundScore({ playerId: host.id, round, points: 50 })
      await repository.setRoundScore({ playerId: alice, round, points: 10 })
      await repository.setRoundScore({ playerId: bob, round, points: 20 })
      if (round < 5) await repository.advanceRound()
    }

    return { repository, host, alice, bob, gameId: created.gameId, storage }
  }

  it("returns the finished game's result under its own game id", async () => {
    const { repository, gameId } = await playFullGame()

    const result = await repository.finishGame()

    expect(result.gameId).toBe(gameId)
  })

  it('returns the injected clock value as finishedAt and the fixed total round count', async () => {
    const { repository } = await playFullGame()

    const result = await repository.finishGame()

    expect(result.finishedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(result.totalRounds).toBe(5)
  })

  it('sets status to finished', async () => {
    const { repository } = await playFullGame()

    await repository.finishGame()

    const emissions = recordEmissions(repository)
    expect(emissions[0]?.status).toBe('finished')
  })

  it('throws when called before the final round is reached', async () => {
    const storage = makeMemoryStorage()
    const repository = makeRepository({ storage })
    await repository.createGame(HOST_CONFIG)
    await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    await expect(repository.finishGame()).rejects.toThrow()
    expect(readPendingResults(storage)).toEqual([])
  })

  // A co-player's row could never pass the self-write-only rule (see buildHostGamePlayer).
  it("queues a pending stats result with only the host's own GamePlayer row on finish", async () => {
    const { repository, gameId, storage } = await playFullGame()

    await repository.finishGame()

    const pending = readPendingResults(storage)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.result).toMatchObject({ gameId, totalRounds: 5 })
    expect(pending[0]?.players).toHaveLength(1)
    expect(pending[0]?.players[0]?.deviceUuid).toBe('device-host')
  })

  it("records the host's own placement (not the winner's) in the queued result", async () => {
    const { repository, storage } = await playFullGame()

    await repository.finishGame()

    // host scored 50/round (worst of the 3: alice 10/round wins, bob 20/round is 2nd).
    const hostPlayer = readPendingResults(storage)[0]?.players[0]
    expect(hostPlayer?.deviceUuid).toBe('device-host')
    expect(hostPlayer?.placement).toBe(3)
  })

  it("computes the host's own best and worst single round from their own varying round scores", async () => {
    const storage = makeMemoryStorage()
    const repository = makeRepository({ storage })
    await repository.createGame(HOST_CONFIG)
    const host = recordEmissions(repository)[0]?.players[0]
    if (!host) throw new Error('expected the host to be seated after createGame')
    const alice = await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    const hostPoints = [10, 40, 0, 25, 15]
    for (const [index, round] of ALL_ROUNDS.entries()) {
      await repository.setRoundScore({ playerId: host.id, round, points: hostPoints[index] ?? 0 })
      await repository.setRoundScore({ playerId: alice, round, points: 5 })
      if (round < 5) await repository.advanceRound()
    }

    await repository.finishGame()

    const hostPlayer = readPendingResults(storage)[0]?.players[0]
    expect(hostPlayer?.deviceUuid).toBe('device-host')
    expect(hostPlayer?.bestRound).toBe(0)
    expect(hostPlayer?.worstRound).toBe(40)
  })

  it('does not fail the game when the pending-queue storage write throws', async () => {
    const throwingStorage = makeThrowingStorage()
    const { repository } = await playFullGame(throwingStorage)

    await expect(repository.finishGame()).resolves.toMatchObject({ totalRounds: 5 })
  })
})

describe('LocalGameRepository persistence', () => {
  it('survives reload: a new instance backed by the same storage picks up where the previous one left off', async () => {
    const sharedStorage = makeMemoryStorage()
    const first = makeRepository({ storage: sharedStorage })
    await first.createGame(HOST_CONFIG)
    await first.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    const second = makeRepository({ storage: sharedStorage })
    const emissions = recordEmissions(second)

    expect(emissions[0]?.players.map((p) => p.name)).toEqual(['Host', 'Alice'])
  })

  it('starts a fresh game instead of crashing when the stored value has an unexpected shape', () => {
    const storage = makeMemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({ unexpected: 'shape', players: 'not-an-array' }))

    const repository = makeRepository({ storage })
    const emissions = recordEmissions(repository)

    expect(emissions[0]).toEqual({
      status: 'waiting',
      currentRound: 1,
      players: [],
      roundScores: [],
    })
  })

  it('starts a fresh game instead of crashing when the stored value is not valid JSON', () => {
    const storage = makeMemoryStorage()
    storage.setItem(STORAGE_KEY, '{not json')

    const repository = makeRepository({ storage })
    const emissions = recordEmissions(repository)

    expect(emissions[0]).toEqual({
      status: 'waiting',
      currentRound: 1,
      players: [],
      roundScores: [],
    })
  })

  it('keeps the game running and still notifies subscribers when storage.setItem throws (e.g. iOS private mode)', async () => {
    const repository = makeRepository({ storage: makeThrowingStorage() })

    const created = await repository.createGame(HOST_CONFIG)
    const emissions = recordEmissions(repository)
    await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    expect(created.gameId).toBe('id-1')
    expect(emissions.at(-1)?.players.map((p) => p.name)).toEqual(['Host', 'Alice'])
  })
})

describe('LocalGameRepository.getResumeInfo / hasPersistedGame', () => {
  it('reports no persisted game before createGame has ever been called', () => {
    const storage = makeMemoryStorage()

    expect(hasPersistedGame(storage)).toBe(false)
    expect(makeRepository({ storage }).getResumeInfo()).toBeNull()
  })

  it('reports a persisted game, with the seated host player id, once created', async () => {
    const storage = makeMemoryStorage()
    const first = makeRepository({ storage })
    const created = await first.createGame(HOST_CONFIG)

    expect(hasPersistedGame(storage)).toBe(true)

    const resumed = new LocalGameRepository({ storage })
    expect(resumed.getResumeInfo()).toEqual({
      gameId: created.gameId,
      hostPlayerId: created.hostPlayerId,
    })
  })

  it('starts fresh (reports no persisted game) when the stored value has an unexpected shape', () => {
    const storage = makeMemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({ unexpected: 'shape' }))

    expect(hasPersistedGame(storage)).toBe(false)
  })
})

describe('hasUnfinishedPersistedGame', () => {
  it('is false before a game is created, true while one is in progress', async () => {
    const storage = makeMemoryStorage()
    expect(hasUnfinishedPersistedGame(storage)).toBe(false)

    await makeRepository({ storage }).createGame(HOST_CONFIG)

    expect(hasUnfinishedPersistedGame(storage)).toBe(true)
  })

  it('is false once the game is finished', async () => {
    const storage = makeMemoryStorage()
    const repository = makeRepository({ storage })
    const created = await repository.createGame(HOST_CONFIG)
    for (const round of [1, 2, 3, 4, 5] as const) {
      await repository.setRoundScore({ playerId: created.hostPlayerId, round, points: 10 })
      if (round < 5) await repository.advanceRound()
    }

    await repository.finishGame()

    expect(hasUnfinishedPersistedGame(storage)).toBe(false)
  })
})

describe('LocalGameRepository.leave', () => {
  it('stops emitting further state changes to a previously subscribed listener', async () => {
    const repository = makeRepository()
    await repository.createGame(HOST_CONFIG)
    const emissions: GameState[] = []
    repository.subscribe((state) => emissions.push(state))
    const countAfterSubscribe = emissions.length

    repository.leave()
    await repository.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    expect(emissions).toHaveLength(countAfterSubscribe)
  })
})
