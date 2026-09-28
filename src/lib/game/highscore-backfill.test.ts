import { describe, expect, it } from 'vitest'
import { planHighscoreBackfill, type BackfillGame } from './highscore-backfill'
import type { GamePlayer } from './types'

function row(gameId: string, uid: string, fields: Partial<GamePlayer> = {}): GamePlayer {
  return {
    gameId,
    deviceUuid: uid,
    displayName: uid === 'alice' ? 'Alice' : 'Bob',
    finalScore: 50,
    placement: 1,
    bestRound: 0,
    worstRound: 30,
    ...fields,
  }
}

function game(
  gameId: string,
  finishedAt: string,
  fields: Partial<BackfillGame> = {},
): BackfillGame {
  return {
    gameId,
    finishedAt,
    participantUids: ['alice', 'bob'],
    roomStatus: 'finished',
    rows: [
      row(gameId, 'alice', { placement: 1, finalScore: 20 }),
      row(gameId, 'bob', { placement: 2, finalScore: 60 }),
    ],
    ...fields,
  }
}

describe('planHighscoreBackfill', () => {
  it("creates each counted row's public entry, copied from the row and its game", () => {
    const plan = planHighscoreBackfill([game('ABCDE', '2026-09-01T18:00:00.000Z')], new Set())

    expect(plan.entries).toContainEqual({
      id: 'ABCDE_alice',
      data: {
        displayName: 'Alice',
        finalScore: 20,
        worstRound: 30,
        finishedAt: '2026-09-01T18:00:00.000Z',
      },
    })
    expect(plan.entries).toHaveLength(2)
  })

  it('counts only finished online games with at least two players, as the rules do', () => {
    const plan = planHighscoreBackfill(
      [
        game('LOCAL', '2026-09-01T18:00:00.000Z', { roomStatus: null }),
        game('ENDED', '2026-09-01T18:00:00.000Z', { roomStatus: 'abandoned' }),
        game('SOLO1', '2026-09-01T18:00:00.000Z', { participantUids: ['alice'] }),
      ],
      new Set(),
    )

    expect(plan.entries).toEqual([])
    expect(plan.totals).toEqual([])
  })

  it('skips entries that already exist but still counts their games in the totals', () => {
    const plan = planHighscoreBackfill(
      [game('ABCDE', '2026-09-01T18:00:00.000Z')],
      new Set(['ABCDE_alice']),
    )

    expect(plan.entries.map((entry) => entry.id)).toEqual(['ABCDE_bob'])
    expect(plan.totals.find((totals) => totals.uid === 'alice')?.data.gamesPlayed).toBe(1)
  })

  it("rebuilds each player's totals over all their games, oldest first, naming the last one", () => {
    const plan = planHighscoreBackfill(
      [
        game('LATER', '2026-09-10T18:00:00.000Z', {
          rows: [
            row('LATER', 'alice', { placement: 2, finalScore: 80 }),
            row('LATER', 'bob', { placement: 1, finalScore: 10 }),
          ],
        }),
        game('FIRST', '2026-09-01T18:00:00.000Z'),
      ],
      new Set(),
    )

    expect(plan.totals.find((totals) => totals.uid === 'alice')?.data).toEqual({
      displayName: 'Alice',
      gamesPlayed: 2,
      wins: 1,
      scoreSum: 100,
      winRate: 0.5,
      averageScore: 50,
      qualified: false,
      lastEntry: 'LATER_alice',
    })
  })
})
