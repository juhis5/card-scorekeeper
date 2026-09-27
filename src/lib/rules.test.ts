import { describe, it, expect } from 'vitest'
import {
  ACE_VALUE,
  FACE_CARD_VALUE,
  JOKER_VALUE,
  LOW_NUMBER_CARD_VALUE,
  MAX_ROUND_SCORE,
  ROUND_SCORE_STEP,
  TEN_VALUE,
  TOTAL_ROUNDS,
  cardValue,
  contractForRound,
  isValidRoundScore,
  placements,
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
