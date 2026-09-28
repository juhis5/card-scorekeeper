import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import GameHighscores from './GameHighscores.vue'
import { i18n, setLocale } from '@/i18n'
import type { GameHighscore } from '@/lib/game/highscores'

const highscores = ref<GameHighscore[]>([])
let followedGame: (() => string | null) | null = null
vi.mock('@/composables/useGameHighscores', () => ({
  useGameHighscores: (gameId: () => string | null) => {
    followedGame = gameId
    return highscores
  },
}))

beforeEach(() => {
  setLocale('en')
  highscores.value = []
})

function renderIt() {
  return render(GameHighscores, { props: { gameId: 'ABCDE' }, global: { plugins: [i18n] } })
}

describe('GameHighscores', () => {
  it("names each list this game's players made, with the place and the points", () => {
    highscores.value = [
      { list: 'worstGames', rank: 3, displayName: 'Host', value: 250 },
      { list: 'biggestRounds', rank: 1, displayName: 'Host', value: 150 },
    ]

    renderIt()

    expect(screen.getByRole('heading', { name: 'Made the highscores' })).toBeTruthy()
    expect(screen.getByText(/Host · Hall of shame · #3 · 250 points/)).toBeTruthy()
    expect(screen.getByText(/Host · Biggest round · #1 · 150 points/)).toBeTruthy()
  })

  it('marks a first place as a new record, and nothing else', () => {
    highscores.value = [
      { list: 'bestGames', rank: 1, displayName: 'Alice', value: 0 },
      { list: 'bestGames', rank: 4, displayName: 'Bob', value: 30 },
    ]

    renderIt()

    expect(screen.getAllByText('New record!')).toHaveLength(1)
  })

  it('shows nothing when the game made no list', () => {
    const { container } = renderIt()

    expect(container.textContent?.trim()).toBe('')
  })

  it('follows the game it is given', () => {
    renderIt()

    expect(followedGame?.()).toBe('ABCDE')
  })
})
