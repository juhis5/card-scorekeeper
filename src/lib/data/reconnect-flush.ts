/** Uploads finished local games queued offline. The logic is in pending-results.ts; this wires
 * the real writer. Firebase loads lazily so an offline host never downloads it. */
import { reportHandledError } from '../platform/error-reporting'
import { withTimeout } from '../platform/timeout'
import { browserLocalStorage } from './key-value-storage'
import {
  flushPendingHighscores,
  flushPendingResults,
  readPendingHighscores,
  readPendingResults,
} from './pending-results'

/** An offline Firestore write waits forever; past this the upload stops and tries again later. */
export const UPLOAD_WRITE_TIMEOUT_MS = 15_000

/** Best-effort: on any failure the results stay queued for the next try. Never throws. Returns how
 * many games went up. */
export async function uploadPendingResults(): Promise<number> {
  try {
    // Most calls have nothing queued: skip loading Firebase.
    if (readPendingResults(browserLocalStorage()).length === 0) return 0
    const [{ getDb, getFirebaseAuth, ensureSignedIn }, { writeGameResult }] = await Promise.all([
      import('./firebase'),
      import('./firestore-stats'),
    ])
    const auth = getFirebaseAuth()
    const db = getDb()

    const { flushed } = await flushPendingResults(browserLocalStorage(), {
      write: async (entry) => {
        const uid = await ensureSignedIn(auth)
        // The no-room game_player rule accepts only a self-write (deviceUuid == auth.uid), so
        // stamp the uid signed in now, not whatever was queued offline.
        const players = entry.players.map((player) => ({ ...player, deviceUuid: uid }))
        await withTimeout(writeGameResult(db, entry.result, players), UPLOAD_WRITE_TIMEOUT_MS)
      },
    })
    return flushed
  } catch (error) {
    // Stays queued for the next try.
    reportHandledError(error, 'upload-pending-results')
    return 0
  }
}

/** Retries highscore entries of online games that failed to publish. Never throws. */
export async function uploadPendingHighscores(): Promise<void> {
  try {
    if (readPendingHighscores(browserLocalStorage()).length === 0) return
    const [{ getDb, ensureSignedIn }, { publishHighscores }] = await Promise.all([
      import('./firebase'),
      import('./firestore-stats'),
    ])
    await ensureSignedIn()
    const db = getDb()
    await flushPendingHighscores(browserLocalStorage(), {
      publish: (entry) => publishHighscores(db, entry.result, entry.players),
    })
  } catch (error) {
    reportHandledError(error, 'upload-pending-highscores')
  }
}
