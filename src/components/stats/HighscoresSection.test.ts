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
    value: 45,
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
  it('opens on the player lists, with rates as percentages and averages with a decimal', async () => {
    await renderWith((store) => {
      store.lists = {
        ...store.lists,
        mostWins: [
          entry({
            id: 'uid-me',
            displayName: 'Juho',
            value: 12,
            gamesPlayed: 20,
            finishedAt: undefined,
            isMine: true,
          }),
        ],
        bestWinRate: [entry({ id: 'r', value: 0.5833, gamesPlayed: 12, finishedAt: undefined })],
        bestAverage: [
          entry({
            id: 'a',
            displayName: 'Mummo',
            value: 96.25,
            gamesPlayed: 8,
            finishedAt: undefined,
          }),
        ],
      }
      store.status = 'loaded'
    })

    expect(screen.getByRole('button', { name: 'Players', pressed: true })).toBeTruthy()
    const wins = screen.getByRole('region', { name: 'Most wins' })
    expect(within(wins).getAllByRole('row')[1]?.textContent).toMatch(/^1Juho · you20 games12$/)
    expect(screen.getByRole('region', { name: 'Best win rate' }).textContent).toContain('58%')
    expect(screen.getByRole('region', { name: 'Best average' }).textContent).toContain('96.3')
    expect(screen.getByRole('region', { name: 'Most games played' }).textContent).toContain(
      'No games yet.',
    )
  })

  it('shows the game records on the Games tab, with dates', async () => {
    await renderWith((store) => {
      store.lists = {
        ...store.lists,
        bestGames: [entry({ id: 'a', displayName: 'Juho', isMine: true }), entry({ id: 'b' })],
        worstGames: [entry({ id: 'c', displayName: 'Jani', value: 735 })],
      }
      store.status = 'loaded'
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Games' }))
    expect(screen.getByRole('button', { name: 'Games', pressed: true })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Most wins' })).toBeNull()

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
