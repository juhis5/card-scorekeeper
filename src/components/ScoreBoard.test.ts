import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import ScoreBoard from './ScoreBoard.vue'
import { standings } from '@/lib/rules'
import { i18n } from '@/i18n'
import type { Player } from '@/lib/types'

const PLAYERS: Player[] = [
  { id: 'a', name: 'Alice', totalScore: 30 },
  { id: 'b', name: 'Bob', totalScore: 10 },
  { id: 'c', name: 'Carol', totalScore: 20 },
]

describe('ScoreBoard', () => {
  it('renders standings sorted ascending so the lowest total leads', () => {
    render(ScoreBoard, {
      props: { standings: standings(PLAYERS) },
      global: { plugins: [i18n] },
    })

    const rows = screen.getAllByRole('row').slice(1) // drop the header row
    const namesInOrder = rows.map((row) => row.textContent ?? '')

    expect(namesInOrder[0]).toContain('Bob')
    expect(namesInOrder[1]).toContain('Carol')
    expect(namesInOrder[2]).toContain('Alice')
  })

  it('marks the leader with text, not color alone', () => {
    render(ScoreBoard, {
      props: { standings: standings(PLAYERS) },
      global: { plugins: [i18n] },
    })

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]?.textContent).toContain('Bob')
    expect(rows[0]?.textContent).toContain('Leader')
    expect(rows[1]?.textContent).not.toContain('Leader')
  })
})
