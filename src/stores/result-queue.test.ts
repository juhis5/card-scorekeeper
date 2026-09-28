import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  appendPendingResult,
  FAILED_RESULTS_STORAGE_KEY,
  readPendingResults,
} from '@/lib/data/pending-results'
import type { PendingResult } from '@/lib/data/pending-results'
import { useResultQueueStore } from './result-queue'

const uploadPendingResultsMock = vi.fn()

vi.mock('@/lib/data/reconnect-flush', () => ({
  uploadPendingResults: () => uploadPendingResultsMock(),
}))

function queuedGame(gameId: string): PendingResult {
  return {
    result: { gameId, finishedAt: '2026-01-01T00:00:00.000Z', totalRounds: 5 },
    players: [],
  }
}

function seedFailed(...gameIds: string[]): void {
  localStorage.setItem(FAILED_RESULTS_STORAGE_KEY, JSON.stringify(gameIds.map(queuedGame)))
}

function setOnline(isOnline: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(isOnline)
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.restoreAllMocks()
  uploadPendingResultsMock.mockReset().mockResolvedValue(0)
  setOnline(true)
})

describe('useResultQueueStore', () => {
  it('counts the games waiting to upload and the ones Firestore refused', () => {
    appendPendingResult(localStorage, queuedGame('g1'))
    seedFailed('f1', 'f2')
    const queue = useResultQueueStore()

    queue.refresh()

    expect(queue.waitingCount).toBe(1)
    expect(queue.failedCount).toBe(2)
  })

  it('uploads the waiting games and recounts afterwards', async () => {
    appendPendingResult(localStorage, queuedGame('g1'))
    uploadPendingResultsMock.mockImplementation(async () => {
      localStorage.clear()
      return 1
    })
    const queue = useResultQueueStore()

    await expect(queue.upload()).resolves.toBe(1)

    expect(queue.waitingCount).toBe(0)
    expect(queue.isUploading).toBe(false)
  })

  it('skips the upload while offline, where the write would only wait', async () => {
    appendPendingResult(localStorage, queuedGame('g1'))
    setOnline(false)

    await useResultQueueStore().upload()

    expect(uploadPendingResultsMock).not.toHaveBeenCalled()
  })

  it('skips the upload when nothing is waiting', async () => {
    await useResultQueueStore().upload()

    expect(uploadPendingResultsMock).not.toHaveBeenCalled()
  })

  it('runs one upload at a time, so two triggers never write a game twice', async () => {
    appendPendingResult(localStorage, queuedGame('g1'))
    let finish: (flushed: number) => void = () => {}
    uploadPendingResultsMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const queue = useResultQueueStore()

    const first = queue.upload()
    const second = queue.upload()
    expect(queue.isUploading).toBe(true)
    finish(1)

    await expect(Promise.all([first, second])).resolves.toEqual([1, 1])
    expect(uploadPendingResultsMock).toHaveBeenCalledTimes(1)
  })

  it('uploads when the browser comes back online', async () => {
    appendPendingResult(localStorage, queuedGame('g1'))
    const target = new EventTarget()
    useResultQueueStore().listen(target)

    target.dispatchEvent(new Event('online'))

    await vi.waitFor(() => expect(uploadPendingResultsMock).toHaveBeenCalledTimes(1))
  })

  it('queues the refused games again and uploads them on retry', async () => {
    seedFailed('f1')
    const queue = useResultQueueStore()

    await queue.retryFailed()

    expect(readPendingResults(localStorage).map((entry) => entry.result.gameId)).toEqual(['f1'])
    expect(queue.failedCount).toBe(0)
    expect(uploadPendingResultsMock).toHaveBeenCalledTimes(1)
  })

  it('discards the refused games for good', () => {
    seedFailed('f1')
    const queue = useResultQueueStore()

    queue.discardFailed()

    expect(queue.failedCount).toBe(0)
    expect(localStorage.getItem(FAILED_RESULTS_STORAGE_KEY)).toBe('[]')
  })
})
