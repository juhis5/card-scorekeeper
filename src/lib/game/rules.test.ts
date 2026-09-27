import { describe, it, expect } from 'vitest'
import {
  roundsWithSeveralZeros,
  ACE_VALUE,
  FACE_CARD_VALUE,
  JOKER_VALUE,
  LOW_NUMBER_CARD_VALUE,
  MAX_ROUND_SCORE,
  ROUND_SCORE_STEP,
  TEN_VALUE,
  TOTAL_ROUNDS,
  cardValue,
  completedRounds,
  contractForRound,
  isEveryRoundScored,
  missingRounds,
  isValidRoundScore,
  placements,
  pointsFor,
  roundTotal,
  runningTotal,
  standings,
  winners,
} from './rules'
import type { Card, Player, RoundScore } from './types'

/** Builds a minimal Player fixture with the given running total. */
function makePlayer(id: string, totalScore: number): Player {
  return { id, name: id, totalScore }
}

describe('isValidRoundScore', () => {
  it('accepts a non-negative integer divisible by 5', () => {
    expect(isValidRoundScore(0)).toBe(true)
    expect(isValidRoundScore(5)).toBe(true)
    expect(isValidRoundScore(55)).toBe(true)
  })

  it('rejects a non-integer', () => {
    expect(isValidRoundScore(5.5)).toBe(false)
  })

  it('rejects a negative number', () => {
    expect(isValidRoundScore(-5)).toBe(false)
  })

  it('rejects a number not divisible by 5', () => {
    expect(isValidRoundScore(3)).toBe(false)
    expect(isValidRoundScore(12)).toBe(false)
    expect(isValidRoundScore(101)).toBe(false)
  })

  it('accepts the cap of 1000 points and rejects anything above it, matching firestore.rules', () => {
    expect(MAX_ROUND_SCORE).toBe(1000)
    expect(isValidRoundScore(MAX_ROUND_SCORE)).toBe(true)
    expect(isValidRoundScore(MAX_ROUND_SCORE + ROUND_SCORE_STEP)).toBe(false)
  })

  it('rejects negative zero, which Firestore stores as a double and the rules reject', () => {
    expect(isValidRoundScore(-0)).toBe(false)
  })
})

describe('cardValue', () => {
  it('values number cards 2–9 at 5 points, and 10 at 10 points', () => {
    const lowRanks: Card['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9']

    lowRanks.forEach((rank) => {
      expect(cardValue({ rank, suit: 'clubs' } as Card)).toBe(LOW_NUMBER_CARD_VALUE)
    })
    expect(cardValue({ rank: '10', suit: 'clubs' })).toBe(TEN_VALUE)
  })

  it('makes every card value a multiple of ROUND_SCORE_STEP, so every hand total is valid', () => {
    const allRanks: Exclude<Card['rank'], 'Joker'>[] = [
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      'J',
      'Q',
      'K',
      'A',
    ]
    const allCards: Card[] = [
      ...allRanks.map((rank): Card => ({ rank, suit: 'hearts' })),
      { rank: 'Joker', suit: null },
    ]

    allCards.forEach((card) => {
      expect(cardValue(card) % ROUND_SCORE_STEP).toBe(0)
    })
  })

  it('values J, Q, and K at 10 points each', () => {
    expect(cardValue({ rank: 'J', suit: 'hearts' })).toBe(FACE_CARD_VALUE)
    expect(cardValue({ rank: 'Q', suit: 'hearts' })).toBe(FACE_CARD_VALUE)
    expect(cardValue({ rank: 'K', suit: 'hearts' })).toBe(FACE_CARD_VALUE)
  })

  it('values an Ace at 15 points', () => {
    expect(cardValue({ rank: 'A', suit: 'spades' })).toBe(ACE_VALUE)
  })

  it('values a Joker at 25 points', () => {
    expect(cardValue({ rank: 'Joker', suit: null })).toBe(JOKER_VALUE)
  })
})

describe('roundTotal', () => {
  it('sums the example hand (4♦, K♠, A♥, Joker) to 55 points', () => {
    const hand: Card[] = [
      { rank: '4', suit: 'diamonds' },
      { rank: 'K', suit: 'spades' },
      { rank: 'A', suit: 'hearts' },
      { rank: 'Joker', suit: null },
    ]

    expect(roundTotal(hand)).toBe(55)
  })

  it('counts every copy of a repeated card — the game is played with 2–3 decks', () => {
    const hand: Card[] = [
      { rank: '7', suit: 'hearts' },
      { rank: '7', suit: 'hearts' },
      { rank: 'Joker', suit: null },
      { rank: 'Joker', suit: null },
    ]

    expect(roundTotal(hand)).toBe(60)
  })
})

describe('contractForRound', () => {
  it('exposes exactly 5 rounds as TOTAL_ROUNDS', () => {
    expect(TOTAL_ROUNDS).toBe(5)
  })

  it('maps round 1 to two sets of three', () => {
    expect(contractForRound(1).melds).toEqual({ setsOfThree: 2, flushes: 0 })
  })

  it('maps round 2 to one set of three and one flush', () => {
    expect(contractForRound(2).melds).toEqual({ setsOfThree: 1, flushes: 1 })
  })

  it('maps round 3 to three sets of three', () => {
    expect(contractForRound(3).melds).toEqual({ setsOfThree: 3, flushes: 0 })
  })

  it('maps round 4 to one flush and two sets of three', () => {
    expect(contractForRound(4).melds).toEqual({ setsOfThree: 2, flushes: 1 })
  })

  it('maps round 5 to two flushes and one set of three', () => {
    expect(contractForRound(5).melds).toEqual({ setsOfThree: 1, flushes: 2 })
  })

  it('gives each round a stable, distinct i18n contract key', () => {
    const keys = [1, 2, 3, 4, 5].map((round) => contractForRound(round).contractKey)

    expect(keys).toEqual([
      'contract.round1',
      'contract.round2',
      'contract.round3',
      'contract.round4',
      'contract.round5',
    ])
  })

  it('throws for a round below 1', () => {
    expect(() => contractForRound(0)).toThrow()
  })

  it('throws for a round above TOTAL_ROUNDS', () => {
    expect(() => contractForRound(6)).toThrow()
  })
})

describe('runningTotal', () => {
  it("sums one player's points across rounds, ignoring other players' scores", () => {
    const roundScores: RoundScore[] = [
      { round: 1, playerId: 'p1', points: 10 },
      { round: 2, playerId: 'p1', points: 20 },
      { round: 1, playerId: 'p2', points: 999 },
    ]

    expect(runningTotal('p1', roundScores)).toBe(30)
  })
})

describe('standings', () => {
  it('sorts standings ascending so the lowest total leads', () => {
    const players = [makePlayer('a', 30), makePlayer('b', 10), makePlayer('c', 20)]

    expect(standings(players).map((standing) => standing.player.id)).toEqual(['b', 'c', 'a'])
  })

  it('returns an empty list for an empty player list', () => {
    expect(standings([])).toEqual([])
  })
})

describe('winners and placements', () => {
  it('declares a single winner when one player has the strictly lowest total', () => {
    const players = [makePlayer('a', 50), makePlayer('b', 30), makePlayer('c', 40)]

    const result = winners(players)

    expect(result.map((standing) => standing.player.id)).toEqual(['b'])
    expect(result[0]?.placement).toBe(1)
  })

  it('makes tied lowest-total players co-winners sharing placement 1', () => {
    const players = [makePlayer('a', 20), makePlayer('b', 20), makePlayer('c', 40)]

    const result = winners(players)

    expect(result.map((standing) => standing.player.id).sort()).toEqual(['a', 'b'])
    expect(result.every((standing) => standing.placement === 1)).toBe(true)
  })

  it('gives the next distinct total placement 3 after a two-way tie for first (competition ranking)', () => {
    const players = [makePlayer('a', 20), makePlayer('b', 20), makePlayer('c', 40)]

    expect(placements(players).map((standing) => standing.placement)).toEqual([1, 1, 3])
  })

  it('declares the sole player the winner with placement 1', () => {
    const players = [makePlayer('solo', 15)]

    expect(winners(players)).toEqual([{ player: players[0], total: 15, placement: 1 }])
  })

  it('returns no winners for an empty player list', () => {
    expect(winners([])).toEqual([])
  })
})

describe('missingRounds', () => {
  const scores: RoundScore[] = [
    { playerId: 'alice', round: 1, points: 10 },
    { playerId: 'alice', round: 2, points: 5 },
    { playerId: 'bob', round: 2, points: 20 },
  ]

  it('lists the rounds up to the given round that a player has no score for', () => {
    expect(missingRounds('bob', scores, 3)).toEqual([1, 3])
  })

  it('is empty for a player who has scored every round so far', () => {
    expect(missingRounds('alice', scores, 2)).toEqual([])
  })

  it('lists every round for a player who joined without scoring', () => {
    expect(missingRounds('carol', scores, 2)).toEqual([1, 2])
  })
})

describe('isEveryRoundScored', () => {
  const scores: RoundScore[] = [
    { playerId: 'alice', round: 1, points: 10 },
    { playerId: 'alice', round: 2, points: 5 },
    { playerId: 'bob', round: 2, points: 20 },
  ]

  it('is true when every player has a score for every round so far', () => {
    expect(isEveryRoundScored(['alice'], scores, 2)).toBe(true)
  })

  it('is false when a late joiner still has an earlier round to fill in', () => {
    expect(isEveryRoundScored(['alice', 'bob'], scores, 2)).toBe(false)
  })

  it('is true for no players', () => {
    expect(isEveryRoundScored([], scores, 2)).toBe(true)
  })
})

describe('roundsWithSeveralZeros', () => {
  it('finds a round where more than one player has 0: only the one who went out scores nothing', () => {
    const scores: RoundScore[] = [
      { playerId: 'alice', round: 1, points: 0 },
      { playerId: 'bob', round: 1, points: 0 },
      { playerId: 'alice', round: 2, points: 0 },
      { playerId: 'bob', round: 2, points: 15 },
    ]

    expect(roundsWithSeveralZeros(['alice', 'bob'], scores, 2)).toEqual([1])
  })

  it('accepts a round with one 0, or none', () => {
    const scores: RoundScore[] = [
      { playerId: 'alice', round: 1, points: 0 },
      { playerId: 'bob', round: 1, points: 20 },
      { playerId: 'alice', round: 2, points: 10 },
      { playerId: 'bob', round: 2, points: 5 },
    ]

    expect(roundsWithSeveralZeros(['alice', 'bob'], scores, 2)).toEqual([])
  })

  it('ignores removed players and rounds that have not started', () => {
    const scores: RoundScore[] = [
      { playerId: 'alice', round: 1, points: 0 },
      { playerId: 'gone', round: 1, points: 0 },
      { playerId: 'alice', round: 3, points: 0 },
      { playerId: 'bob', round: 3, points: 0 },
    ]

    expect(roundsWithSeveralZeros(['alice', 'bob'], scores, 2)).toEqual([])
  })
})

describe('completedRounds', () => {
  it('counts the rounds before the current one while a game is running', () => {
    expect(completedRounds(1, 'waiting')).toBe(0)
    expect(completedRounds(1, 'playing')).toBe(0)
    expect(completedRounds(3, 'playing')).toBe(2)
  })

  it('counts every round once the game is finished', () => {
    expect(completedRounds(5, 'finished')).toBe(TOTAL_ROUNDS)
  })
})

describe('pointsFor', () => {
  const scores: RoundScore[] = [
    { playerId: 'alice', round: 1, points: 0 },
    { playerId: 'alice', round: 2, points: 15 },
    { playerId: 'bob', round: 2, points: 20 },
  ]

  it("returns the player's points for that round", () => {
    expect(pointsFor('alice', 2, scores)).toBe(15)
  })

  it('returns 0 for a scored zero, not "no score"', () => {
    expect(pointsFor('alice', 1, scores)).toBe(0)
  })

  it('returns null when the player has no score for that round', () => {
    expect(pointsFor('bob', 1, scores)).toBeNull()
  })
})
