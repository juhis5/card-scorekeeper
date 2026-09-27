import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/vue'
import ScoreBoard from './ScoreBoard.vue'
import { boardRows } from '@/lib/scoreboard'
import { i18n } from '@/i18n'
import type { Player, RoundScore } from '@/lib/types'

const PLAYERS: Player[] = [
  { id: 'a', name: 'Alice', totalScore: 0 },
  { id: 'b', name: 'Bob', totalScore: 0 },
  { id: 'c', name: 'Carol', totalScore: 0 },
]

const SCORES: RoundScore[] = [
  { playerId: 'a', round: 1, points: 30 },
  { playerId: 'b', round: 1, points: 10 },
  { playerId: 'c', round: 1, points: 0 },
  { playerId: 'b', round: 2, points: 15 },
]

function renderBoard(completedRounds: number, scores: RoundScore[] = SCORES) {
  return render(ScoreBoard, {
    props: { rows: boardRows(PLAYERS, scores, completedRounds), completedRounds },
    global: { plugins: [i18n] },
  })
}

function bodyRows(): HTMLElement[] {
  return screen.getAllByRole('row').slice(1) // drop the header row
}

describe('ScoreBoard', () => {
  it('sorts rows ascending by revealed total so the lowest leads', () => {
    renderBoard(1)

    expect(bodyRows().map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      expect.stringContaining('Carol'),
      expect.stringContaining('Bob'),
      expect.stringContaining('Alice'),
    ])
  })

  it('has a column per round, named for screen readers', () => {
    renderBoard(1)

    for (const round of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole('columnheader', { name: `Round ${round}` })).toBeTruthy()
    }
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeTruthy()
  })

  it('shows revealed rounds as numbers, the round in progress only as entered', () => {
    renderBoard(1)

    const bob = bodyRows().find((row) => row.textContent?.includes('Bob'))
    const cells = within(bob as HTMLElement).getAllByRole('cell')
    expect(cells[0]?.textContent?.trim()).toBe('10')
    expect(cells[1]?.textContent).toContain('Entered')
    expect(cells[1]?.textContent).not.toContain('15')
    expect(cells[2]?.textContent).toContain('No score')
    expect(cells[5]?.textContent?.trim()).toBe('10')
  })

  it('shows a scored zero as 0, not as no score', () => {
    renderBoard(1)

    const carol = bodyRows().find((row) => row.textContent?.includes('Carol'))
    const cells = within(carol as HTMLElement).getAllByRole('cell')
    expect(cells[0]?.textContent?.trim()).toBe('0')
  })

  it('writes a 1000-point round without a thousands separator, so it fits its narrow column', () => {
    renderBoard(1, [{ playerId: 'a', round: 1, points: 1000 }])

    const alice = bodyRows().find((row) => row.textContent?.includes('Alice'))
    const cells = within(alice as HTMLElement).getAllByRole('cell')
    expect(cells[0]?.textContent?.trim()).toBe('1000')
  })

  it('marks the leader with an icon and text, not color alone', () => {
    renderBoard(1)

    const [leader, second] = bodyRows()
    expect(leader?.textContent).toContain('Carol')
    expect(leader?.textContent).toContain('Leader')
    expect(second?.textContent).not.toContain('Leader')
  })

  it('marks no leader before a round is complete, when everyone is tied at 0', () => {
    renderBoard(0)

    for (const row of bodyRows()) {
      expect(row.textContent).not.toContain('Leader')
      expect(row.classList.contains('bg-muted')).toBe(false)
    }
  })
})
