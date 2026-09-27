import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import StatSummary from './StatSummary.vue'
import { i18n } from '@/i18n'
import type { PlayerStats } from '@/lib/game/stats'

// Every value differs, so an exact `getByText` never matches two tiles.
const STATS: PlayerStats = {
  deviceUuid: 'uid-me',
  gamesPlayed: 3,
  wins: 1,
  winRate: 1 / 3,
  bestFinalScore: 15,
  worstFinalScore: 80,
  bestRound: 4,
  worstRound: 35,
  averageFinalScore: 43.256,
}

function renderSummary(stats: PlayerStats) {
  return render(StatSummary, { props: { stats }, global: { plugins: [i18n] } })
}

describe('StatSummary', () => {
  it('shows games played, wins, and win rate as a percentage', () => {
    renderSummary(STATS)

    expect(screen.getByText('Games played')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('Wins')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('Win rate')).toBeTruthy()
    expect(screen.getByText('33%')).toBeTruthy()
  })

  it('shows best/worst final score and best/worst single round', () => {
    renderSummary(STATS)

    expect(screen.getByText('Best final score')).toBeTruthy()
    expect(screen.getByText('15')).toBeTruthy()
    expect(screen.getByText('Worst final score')).toBeTruthy()
    expect(screen.getByText('80')).toBeTruthy()
    expect(screen.getByText('Best single round')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText('Worst single round')).toBeTruthy()
    expect(screen.getByText('35')).toBeTruthy()
  })

  it('shows the average final score rounded to one decimal place', () => {
    renderSummary(STATS)

    expect(screen.getByText('Average final score')).toBeTruthy()
    expect(screen.getByText('43.3')).toBeTruthy()
  })

  it('shows a placeholder, not a crash, for null scores when no games have been played', () => {
    renderSummary({
      deviceUuid: 'uid-me',
      gamesPlayed: 0,
      wins: 0,
      winRate: 0,
      bestFinalScore: null,
      worstFinalScore: null,
      bestRound: null,
      worstRound: null,
      averageFinalScore: null,
    })

    expect(screen.getByText('0%')).toBeTruthy()
    // The five null stats each show a dash.
    expect(screen.getAllByText('–')).toHaveLength(5)
  })
})
