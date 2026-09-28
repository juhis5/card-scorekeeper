import { describe, expect, it } from 'vitest'
import {
  gamePlayerRows,
  bestAndWorstRound,
  headToHead,
  nextPlayerTotals,
  playerStats,
  QUALIFYING_GAMES,
} from './stats'
import type { GamePlayer } from './types'

const HOST = 'device-host'
const ALICE = 'device-alice'
const BOB = 'device-bob'

function gamePlayer(
  overrides: Partial<GamePlayer> & Pick<GamePlayer, 'gameId' | 'deviceUuid'>,
): GamePlayer {
  return {
    displayName: 'Player',
    finalScore: 0,
    placement: 1,
    bestRound: 0,
    worstRound: 0,
    ...overrides,
  }
}

describe('playerStats', () => {
  it("counts only this device's rows, even where an opponent holds every extreme", () => {
    // Two games; Alice beats the host in both, with the lowest final and round, and the highest
    // round too. None of her numbers may leak into the host's stats.
    const rows = [
      gamePlayer({
        gameId: 'g1',
        deviceUuid: HOST,
        finalScore: 60,
        placement: 2,
        bestRound: 5,
        worstRound: 30,
      }),
      gamePlayer({
        gameId: 'g1',
        deviceUuid: ALICE,
        finalScore: 10,
        placement: 1,
        bestRound: 0,
        worstRound: 90,
      }),
      gamePlayer({
        gameId: 'g2',
        deviceUuid: HOST,
        finalScore: 40,
        placement: 2,
        bestRound: 10,
        worstRound: 20,
      }),
      gamePlayer({
        gameId: 'g2',
        deviceUuid: ALICE,
        finalScore: 5,
        placement: 1,
        bestRound: 0,
        worstRound: 95,
      }),
    ]

    expect(playerStats(HOST, rows)).toEqual({
      deviceUuid: HOST,
      gamesPlayed: 2,
      wins: 0,
      winRate: 0,
      bestFinalScore: 40,
      worstFinalScore: 60,
      bestRound: 5,
      worstRound: 30,
      averageFinalScore: 50,
    })
  })

  it('reports zeroed counts and null scores for a player with no games', () => {
    expect(playerStats(HOST, [])).toEqual({
      deviceUuid: HOST,
      gamesPlayed: 0,
      wins: 0,
      winRate: 0,
      bestFinalScore: null,
      worstFinalScore: null,
      bestRound: null,
      worstRound: null,
      averageFinalScore: null,
    })
  })

  it('counts games played across multiple games for the same device, ignoring other players', () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST }),
      gamePlayer({ gameId: 'g1', deviceUuid: ALICE }),
      gamePlayer({ gameId: 'g2', deviceUuid: HOST }),
    ]

    expect(playerStats(HOST, games).gamesPlayed).toBe(2)
  })

  it('counts wins as games finished in placement 1 and computes the win rate', () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST, placement: 1 }),
      gamePlayer({ gameId: 'g2', deviceUuid: HOST, placement: 2 }),
      gamePlayer({ gameId: 'g3', deviceUuid: HOST, placement: 1 }),
      gamePlayer({ gameId: 'g4', deviceUuid: HOST, placement: 3 }),
    ]

    const stats = playerStats(HOST, games)
    expect(stats.wins).toBe(2)
    expect(stats.winRate).toBe(0.5)
  })

  it('counts a shared placement-1 (co-winner tie) as a win', () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST, placement: 1 }),
      gamePlayer({ gameId: 'g1', deviceUuid: ALICE, placement: 1 }),
    ]

    expect(playerStats(HOST, games).wins).toBe(1)
    expect(playerStats(ALICE, games).wins).toBe(1)
  })

  it('computes the best (lowest) and worst (highest) final score across games', () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST, finalScore: 80 }),
      gamePlayer({ gameId: 'g2', deviceUuid: HOST, finalScore: 45 }),
      gamePlayer({ gameId: 'g3', deviceUuid: HOST, finalScore: 120 }),
    ]

    const stats = playerStats(HOST, games)
    expect(stats.bestFinalScore).toBe(45)
    expect(stats.worstFinalScore).toBe(120)
  })

  it('computes the best (lowest) and worst (highest) single round across games', () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST, bestRound: 5, worstRound: 40 }),
      gamePlayer({ gameId: 'g2', deviceUuid: HOST, bestRound: 0, worstRound: 55 }),
    ]

    const stats = playerStats(HOST, games)
    expect(stats.bestRound).toBe(0)
    expect(stats.worstRound).toBe(55)
  })

  it('computes the average final score across games', () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST, finalScore: 10 }),
      gamePlayer({ gameId: 'g2', deviceUuid: HOST, finalScore: 20 }),
      gamePlayer({ gameId: 'g3', deviceUuid: HOST, finalScore: 30 }),
    ]

    expect(playerStats(HOST, games).averageFinalScore).toBe(20)
  })

  it('reports a single game correctly (best/worst/average all equal that one score)', () => {
    const games: GamePlayer[] = [gamePlayer({ gameId: 'g1', deviceUuid: HOST, finalScore: 42 })]

    const stats = playerStats(HOST, games)
    expect(stats.gamesPlayed).toBe(1)
    expect(stats.bestFinalScore).toBe(42)
    expect(stats.worstFinalScore).toBe(42)
    expect(stats.averageFinalScore).toBe(42)
  })
})

describe('headToHead', () => {
  it('returns a zeroed record for two players who never shared a game', () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST }),
      gamePlayer({ gameId: 'g2', deviceUuid: ALICE }),
    ]

    expect(headToHead(HOST, ALICE, games)).toEqual({
      deviceUuid: HOST,
      opponentDeviceUuid: ALICE,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      ties: 0,
    })
  })

  it('counts a win when the placement is lower (better) than the opponent in a shared game', () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST, placement: 1 }),
      gamePlayer({ gameId: 'g1', deviceUuid: ALICE, placement: 2 }),
    ]

    const record = headToHead(HOST, ALICE, games)
    expect(record.gamesPlayed).toBe(1)
    expect(record.wins).toBe(1)
    expect(record.losses).toBe(0)
  })

  it('counts a loss when the placement is higher (worse) than the opponent in a shared game', () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST, placement: 3 }),
      gamePlayer({ gameId: 'g1', deviceUuid: ALICE, placement: 1 }),
    ]

    expect(headToHead(HOST, ALICE, games).losses).toBe(1)
  })

  it('counts a tie when both share the same placement in a shared game', () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST, placement: 1 }),
      gamePlayer({ gameId: 'g1', deviceUuid: ALICE, placement: 1 }),
    ]

    expect(headToHead(HOST, ALICE, games).ties).toBe(1)
  })

  it('only counts games where both device UUIDs actually played, ignoring games either played alone', () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST, placement: 1 }),
      gamePlayer({ gameId: 'g1', deviceUuid: ALICE, placement: 2 }),
      gamePlayer({ gameId: 'g2', deviceUuid: HOST, placement: 1 }),
      gamePlayer({ gameId: 'g3', deviceUuid: ALICE, placement: 1 }),
      gamePlayer({ gameId: 'g3', deviceUuid: BOB, placement: 2 }),
    ]

    expect(headToHead(HOST, ALICE, games).gamesPlayed).toBe(1)
  })

  it('accumulates a W/L/T record across several shared games', () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST, placement: 1 }),
      gamePlayer({ gameId: 'g1', deviceUuid: ALICE, placement: 2 }),
      gamePlayer({ gameId: 'g2', deviceUuid: HOST, placement: 2 }),
      gamePlayer({ gameId: 'g2', deviceUuid: ALICE, placement: 1 }),
      gamePlayer({ gameId: 'g3', deviceUuid: HOST, placement: 1 }),
      gamePlayer({ gameId: 'g3', deviceUuid: ALICE, placement: 1 }),
    ]

    expect(headToHead(HOST, ALICE, games)).toEqual({
      deviceUuid: HOST,
      opponentDeviceUuid: ALICE,
      gamesPlayed: 3,
      wins: 1,
      losses: 1,
      ties: 1,
    })
  })

  it("is a mirror image from the opponent's perspective", () => {
    const games: GamePlayer[] = [
      gamePlayer({ gameId: 'g1', deviceUuid: HOST, placement: 1 }),
      gamePlayer({ gameId: 'g1', deviceUuid: ALICE, placement: 2 }),
    ]

    const fromHost = headToHead(HOST, ALICE, games)
    const fromAlice = headToHead(ALICE, HOST, games)
    expect(fromAlice.wins).toBe(fromHost.losses)
    expect(fromAlice.losses).toBe(fromHost.wins)
    expect(fromAlice.ties).toBe(fromHost.ties)
  })
})

describe('bestAndWorstRound', () => {
  it('picks the lowest points as the best round and the highest as the worst', () => {
    expect(bestAndWorstRound([12, 40, 0, 25])).toEqual({ bestRound: 0, worstRound: 40 })
  })

  it('treats a single round as both the best and the worst', () => {
    expect(bestAndWorstRound([18])).toEqual({ bestRound: 18, worstRound: 18 })
  })

  it('throws for an empty list of round points', () => {
    expect(() => bestAndWorstRound([])).toThrow(RangeError)
  })
})

describe('nextPlayerTotals', () => {
  const row = (placement: number, finalScore: number): GamePlayer => ({
    gameId: 'g',
    deviceUuid: 'uid',
    displayName: 'Juho',
    finalScore,
    placement,
    bestRound: 0,
    worstRound: 40,
  })

  it("starts a player's totals from their first game", () => {
    expect(nextPlayerTotals(null, row(1, 60), 'g_uid')).toEqual({
      displayName: 'Juho',
      gamesPlayed: 1,
      wins: 1,
      scoreSum: 60,
      winRate: 1,
      averageScore: 60,
      qualified: false,
      lastEntry: 'g_uid',
    })
  })

  it('adds a game: a shared first place counts as a win, like your own stats', () => {
    const first = nextPlayerTotals(null, row(1, 60), 'g1_uid')
    const second = nextPlayerTotals(first, { ...row(2, 90), displayName: 'Juho K' }, 'g2_uid')

    expect(second).toMatchObject({
      displayName: 'Juho K',
      gamesPlayed: 2,
      wins: 1,
      scoreSum: 150,
      winRate: 0.5,
      averageScore: 75,
      lastEntry: 'g2_uid',
    })
  })

  it(`qualifies for the rate and average lists at ${QUALIFYING_GAMES} games`, () => {
    let totals = null
    for (let game = 1; game < QUALIFYING_GAMES; game += 1) {
      totals = nextPlayerTotals(totals, row(3, 100), `g${game}_uid`)
    }
    expect(totals?.qualified).toBe(false)

    expect(nextPlayerTotals(totals, row(3, 100), 'last_uid').qualified).toBe(true)
  })
})

describe('gamePlayerRows', () => {
  const players = [
    { id: 'host', name: 'Host', totalScore: 0 },
    { id: 'alice', name: 'Alice', totalScore: 999 },
    { id: 'bob', name: 'Bob', totalScore: 0 },
  ]
  const scores = [
    { playerId: 'host', round: 1, points: 20 },
    { playerId: 'alice', round: 1, points: 0 },
    { playerId: 'bob', round: 1, points: 20 },
    { playerId: 'host', round: 2, points: 0 },
    { playerId: 'alice', round: 2, points: 15 },
    { playerId: 'bob', round: 2, points: 5 },
  ] as const

  it('places everyone on totals summed from the round scores, never a stored total', () => {
    const rows = gamePlayerRows('g1', players, [...scores])

    expect(rows.map((row) => [row.displayName, row.finalScore, row.placement])).toEqual([
      ['Alice', 15, 1],
      ['Host', 20, 2],
      ['Bob', 25, 3],
    ])
  })

  it("gives each row the game, the player's key, and their own best and worst round", () => {
    const rows = gamePlayerRows('g1', players, [...scores])

    expect(rows.find((row) => row.deviceUuid === 'bob')).toEqual({
      gameId: 'g1',
      deviceUuid: 'bob',
      displayName: 'Bob',
      finalScore: 25,
      placement: 3,
      bestRound: 5,
      worstRound: 20,
    })
  })

  it('shares a placement on equal totals', () => {
    const tied = [
      { playerId: 'host', round: 1, points: 0 },
      { playerId: 'alice', round: 1, points: 10 },
      { playerId: 'bob', round: 1, points: 10 },
    ] as const

    const rows = gamePlayerRows('g1', players, [...tied])

    expect(rows.map((row) => row.placement)).toEqual([1, 2, 2])
  })
})
