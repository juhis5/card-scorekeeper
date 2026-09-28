/**
 * Finished local games not yet in the stats: how many wait to upload, how many Firestore refused
 * for good, and the upload itself. Uploads on launch, when the browser comes back online and when
 * Stats opens.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { browserLocalStorage } from '@/lib/data/key-value-storage'
import {
  discardFailedResults,
  readFailedResults,
  readPendingHighscores,
  readPendingResults,
  retryFailedResults,
} from '@/lib/data/pending-results'
import { uploadPendingHighscores, uploadPendingResults } from '@/lib/data/reconnect-flush'

export const useResultQueueStore = defineStore('result-queue', () => {
  const waitingCount = ref(0)
  const failedCount = ref(0)
  const isUploading = ref(false)
  let inFlight: Promise<number> | null = null

  /** Storage is the source of truth: a local game queues its result there directly. */
  function refresh(): void {
    const storage = browserLocalStorage()
    waitingCount.value = readPendingResults(storage).length
    failedCount.value = readFailedResults(storage).length
  }

  /** Never throws. Resolves to how many games went up; a second call joins the one in flight.
   * Also retries online games' highscore entries that failed to publish. */
  function upload(): Promise<number> {
    if (inFlight) return inFlight
    refresh()
    const hasHighscores = readPendingHighscores(browserLocalStorage()).length > 0
    if ((waitingCount.value === 0 && !hasHighscores) || !navigator.onLine) return Promise.resolve(0)
    isUploading.value = true
    inFlight = Promise.all([uploadPendingResults(), uploadPendingHighscores()])
      .then(([flushed]) => flushed)
      .finally(() => {
        inFlight = null
        isUploading.value = false
        refresh()
      })
    return inFlight
  }

  function retryFailed(): Promise<number> {
    retryFailedResults(browserLocalStorage())
    return upload()
  }

  function discardFailed(): void {
    discardFailedResults(browserLocalStorage())
    refresh()
  }

  function listen(target: EventTarget): void {
    target.addEventListener('online', () => void upload())
  }

  return {
    waitingCount,
    failedCount,
    isUploading,
    refresh,
    upload,
    retryFailed,
    discardFailed,
    listen,
  }
})
