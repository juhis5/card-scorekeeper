import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import HighscoresSection from './HighscoresSection.vue'
import { i18n, setLocale } from '@/i18n'
import { useHighscoresStore, type HighscoreEntry } from '@/stores/highscores'

function entry(overrides: Partial<HighscoreEntry>): HighscoreEntry {
  return {
    id: 'g_uid',
    rank: 1,
    displayName: 'Ripa',
    points: 45,
    finishedAt: '2026-09-14T18:00:00.000Z',
    isMine: false,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  setLocale('en')
})

async function renderWith(load: (store: ReturnType<typeof useHighscoresStore>) => void) {
  const store = useHighscoresStore()
  vi.spyOn(store, 'load').mockImplementation(async () => load(store))
  render(HighscoresSection, { global: { plugins: [i18n] } })
  await flushPromises()
  return store
}

describe('HighscoresSection', () => {
  it('shows the three lists with names, dates and points, marking your own entry in words', async () => {
    await renderWith((store) => {
      store.lists = {
        bestGames: [entry({ id: 'a', displayName: 'Juho', isMine: true }), entry({ id: 'b' })],
        worstGames: [entry({ id: 'c', displayName: 'Jani', points: 735 })],
        biggestRounds: [],
      }
      store.status = 'loaded'
    })

    const best = screen.getByRole('region', { name: 'Best game' })
    expect(
      within(best)
        .getAllByRole('row')
        .map((row) => row.textContent),
    ).toEqual([
      '#PlayerPoints',
      expect.stringMatching(/^1Juho · you.*45$/),
      expect.stringMatching(/^1Ripa.*45$/),
    ])
    expect(screen.getByRole('region', { name: 'Hall of shame' }).textContent).toContain('735')
    expect(screen.getByRole('region', { name: 'Biggest round' }).textContent).toContain(
      'No games yet.',
    )
  })

  it('says when the board cannot be read, and retries on request', async () => {
    const store = await renderWith((highscores) => {
      highscores.status = 'error'
    })

    expect(screen.getByRole('alert').textContent).toContain("Couldn't load the highscores")
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(store.load).toHaveBeenCalledTimes(2)
  })
})
