import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import ResultQueueNotice from './ResultQueueNotice.vue'
import { i18n, setLocale } from '@/i18n'
import {
  appendPendingResult,
  FAILED_RESULTS_STORAGE_KEY,
  readFailedResults,
} from '@/lib/data/pending-results'
import type { PendingResult } from '@/lib/data/pending-results'
import { useResultQueueStore } from '@/stores/result-queue'

const uploadPendingResultsMock = vi.fn()
const uploadPendingHighscoresMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/data/reconnect-flush', () => ({
  uploadPendingResults: () => uploadPendingResultsMock(),
  uploadPendingHighscores: () => uploadPendingHighscoresMock(),
}))

function queuedGame(gameId: string): PendingResult {
  return {
    result: { gameId, finishedAt: '2026-01-01T00:00:00.000Z', totalRounds: 5 },
    players: [],
  }
}

function renderNotice() {
  useResultQueueStore().refresh()
  return render(ResultQueueNotice, { global: { plugins: [i18n] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  setLocale('en')
  localStorage.clear()
  uploadPendingResultsMock.mockReset().mockResolvedValue(0)
})

describe('ResultQueueNotice', () => {
  it('shows nothing when every game is in the stats', () => {
    const { container } = renderNotice()

    expect(container.textContent?.trim()).toBe('')
  })

  it('says how many finished games are still waiting to upload', () => {
    appendPendingResult(localStorage, queuedGame('g1'))
    appendPendingResult(localStorage, queuedGame('g2'))

    renderNotice()

    expect(screen.getByText('2 games are waiting to upload.')).toBeTruthy()
    expect(screen.getByText("They're added to your stats once this device is online.")).toBeTruthy()
  })

  it('offers a retry for refused games and reports when they went up', async () => {
    localStorage.setItem(FAILED_RESULTS_STORAGE_KEY, JSON.stringify([queuedGame('f1')]))
    uploadPendingResultsMock.mockImplementation(async () => {
      localStorage.clear()
      return 1
    })
    const { emitted } = renderNotice()
    expect(screen.getByText("1 game couldn't be saved to your stats.")).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flushPromises()

    expect(emitted().uploaded).toHaveLength(1)
    expect(screen.queryByText("1 game couldn't be saved to your stats.")).toBeNull()
  })

  it('deletes refused games only after the confirm', async () => {
    localStorage.setItem(FAILED_RESULTS_STORAGE_KEY, JSON.stringify([queuedGame('f1')]))
    renderNotice()

    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('alertdialog', { name: 'Delete the unsaved games?' })).toBeTruthy()
    expect(readFailedResults(localStorage)).toHaveLength(1)
    await fireEvent.click(screen.getByRole('button', { name: 'Delete the games' }))

    expect(readFailedResults(localStorage)).toEqual([])
    expect(screen.queryByText("1 game couldn't be saved to your stats.")).toBeNull()
  })

  it('keeps refused games when the confirm is cancelled', async () => {
    localStorage.setItem(FAILED_RESULTS_STORAGE_KEY, JSON.stringify([queuedGame('f1')]))
    renderNotice()

    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Keep the games' }))

    expect(readFailedResults(localStorage)).toHaveLength(1)
  })
})
