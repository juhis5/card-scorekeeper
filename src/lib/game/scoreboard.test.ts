import { describe, expect, it } from 'vitest'
import { boardRows } from './scoreboard'
import type { Player, RoundScore } from './types'

function player(id: string): Player {
  return { id, name: id, totalScore: 0 }
}

const ALICE = player('alice')
const BOB = player('bob')
const CAROL = player('carol')

describe('boardRows', () => {
  const scores: RoundScore[] = [
    { playerId: 'alice', round: 1, points: 10 },
    { playerId: 'bob', round: 1, points: 0 },
    { playerId: 'alice', round: 2, points: 15 },
  ]

  it('shows revealed rounds as numbers and the current round only as entered', () => {
    const [bob, alice] = boardRows([ALICE, BOB], scores, 1)

    expect(alice?.cells).toEqual([
      { kind: 'points', points: 10 },
      { kind: 'entered' },
      { kind: 'empty' },
      { kind: 'empty' },
      { kind: 'empty' },
    ])
    expect(bob?.cells).toEqual([
      { kind: 'points', points: 0 },
      { kind: 'empty' },
      { kind: 'empty' },
      { kind: 'empty' },
      { kind: 'empty' },
    ])
  })

  it('totals and ranks on revealed rounds only, ignoring the round in progress', () => {
    const rows = boardRows([ALICE, BOB], scores, 1)

    expect(rows.map((row) => [row.player.id, row.total, row.placement])).toEqual([
      ['bob', 0, 1],
      ['alice', 10, 2],
    ])
  })

  it('reveals every round once the game is finished', () => {
    const finished: RoundScore[] = [1, 2, 3, 4, 5].flatMap((round) => [
      { playerId: 'alice', round: round as 1 | 2 | 3 | 4 | 5, points: 10 },
      { playerId: 'bob', round: round as 1 | 2 | 3 | 4 | 5, points: 5 },
    ])

    const [bob, alice] = boardRows([ALICE, BOB], finished, 5)

    expect(bob?.total).toBe(25)
    expect(alice?.total).toBe(50)
    expect(alice?.cells.every((cell) => cell.kind === 'points')).toBe(true)
  })

  it('ties share a placement and the next total skips ahead', () => {
    const tied: RoundScore[] = [
      { playerId: 'alice', round: 1, points: 10 },
      { playerId: 'bob', round: 1, points: 10 },
      { playerId: 'carol', round: 1, points: 20 },
    ]

    const rows = boardRows([ALICE, BOB, CAROL], tied, 1)

    expect(rows.map((row) => row.placement)).toEqual([1, 1, 3])
  })

  it('gives a player with a revealed round still to fill no placement, after everyone else', () => {
    // Carol joined late: round 1 is revealed but hers is missing, so her low total means nothing.
    const rows = boardRows([ALICE, BOB, CAROL], scores, 1)

    expect(rows.map((row) => [row.player.id, row.placement])).toEqual([
      ['bob', 1],
      ['alice', 2],
      ['carol', null],
    ])
    expect(rows[2]?.cells[0]).toEqual({ kind: 'empty' })
  })

  it('orders the players with a revealed round still to fill by their total, lowest first', () => {
    const lateJoiners: RoundScore[] = [
      { playerId: 'alice', round: 1, points: 0 },
      { playerId: 'alice', round: 2, points: 10 },
      { playerId: 'bob', round: 2, points: 30 },
      { playerId: 'carol', round: 2, points: 5 },
    ]

    const rows = boardRows([ALICE, BOB, CAROL], lateJoiners, 2)

    expect(rows.map((row) => [row.player.id, row.total, row.placement])).toEqual([
      ['alice', 10, 1],
      ['carol', 5, null],
      ['bob', 30, null],
    ])
  })

  it('ranks everyone first at 0 before any round is revealed', () => {
    const rows = boardRows([ALICE, BOB], scores, 0)

    expect(rows.map((row) => [row.total, row.placement])).toEqual([
      [0, 1],
      [0, 1],
    ])
    expect(rows.find((row) => row.player.id === 'alice')?.cells[0]).toEqual({ kind: 'entered' })
  })
})
