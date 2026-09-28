import { describe, expect, it } from 'vitest'
import { highscoresOfGame, rankAt } from './highscores'

describe('rankAt', () => {
  it('gives equal values the rank of the first of them (1, 1, 3)', () => {
    const values = [0, 0, 15, 20, 20]

    expect(values.map((_, index) => rankAt(values, index))).toEqual([1, 1, 3, 4, 4])
  })
})

describe('highscoresOfGame', () => {
  const lists = {
    bestGames: [
      { id: 'OTHER_x', data: { displayName: 'Ripa', finalScore: 0 } },
      { id: 'ABCDE_alice', data: { displayName: 'Alice', finalScore: 0 } },
      { id: 'ABCDE_host', data: { displayName: 'Host', finalScore: 40 } },
    ],
    worstGames: [{ id: 'ABCDE_host', data: { displayName: 'Host', finalScore: 5000 } }],
    biggestRounds: [
      { id: 'OTHER_y', data: { displayName: 'Mummo', worstRound: 1000 } },
      { id: 'ABCDE_host', data: { displayName: 'Host', worstRound: 1000 } },
    ],
  }

  it("lists this game's players on each list they made, with their shared rank and value", () => {
    expect(highscoresOfGame('ABCDE', lists)).toEqual([
      { list: 'bestGames', rank: 1, displayName: 'Alice', value: 0 },
      { list: 'bestGames', rank: 3, displayName: 'Host', value: 40 },
      { list: 'worstGames', rank: 1, displayName: 'Host', value: 5000 },
      { list: 'biggestRounds', rank: 1, displayName: 'Host', value: 1000 },
    ])
  })

  it('finds nothing for a game none of whose players made a list', () => {
    expect(highscoresOfGame('ZZZZZ', lists)).toEqual([])
  })

  it('never mistakes a game whose code starts the same for this one', () => {
    const lookalike = {
      bestGames: [{ id: 'ABCDEF_alice', data: { displayName: 'Alice', finalScore: 0 } }],
      worstGames: [],
      biggestRounds: [],
    }

    expect(highscoresOfGame('ABCDE', lookalike)).toEqual([])
  })
})
