import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { render, screen } from '@testing-library/vue'
import HighscoresView from './HighscoresView.vue'
import { i18n, setLocale } from '@/i18n'
import { useHighscoresStore } from '@/stores/highscores'

beforeEach(() => {
  setActivePinia(createPinia())
  setLocale('en')
})

describe('HighscoresView', () => {
  it('is its own page: a Highscores heading over the lists', () => {
    vi.spyOn(useHighscoresStore(), 'load').mockResolvedValue()

    render(HighscoresView, { global: { plugins: [i18n] } })

    expect(screen.getByRole('heading', { level: 1, name: 'Highscores' })).toBeTruthy()
    expect(screen.getByText('Across every game played with the app.')).toBeTruthy()
  })
})
