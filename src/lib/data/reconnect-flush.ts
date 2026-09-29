/** Uploads finished local games queued offline. The logic is in pending-results.ts; this wires
 * the real writer. Firebase loads lazily so an offline host never downloads it. */
import { reportHandledError } from '../platform/error-reporting'
import { withTimeout } from '../platform/timeout'
import { forgetAcceptedInvite, readAcceptedInvites } from './accepted-invites'
import { browserLocalStorage } from './key-value-storage'
import {
  appendPendingHighscores,
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

/**
 * Counts invites accepted while their game ran, once it has finished, one at a time (each updates
 * the same running totals). One whose game ended without a result, or that was answered
 * elsewhere, is dropped; one still running waits. Never throws. Resolves to how many counted.
 */
export async function countAcceptedInvites(): Promise<number> {
  const storage = browserLocalStorage()
  let countedGames = 0
  try {
    const waiting = readAcceptedInvites(storage)
    if (waiting.length === 0) return 0
    const [{ getDb, ensureSignedIn }, invites, { publishHighscores }] = await Promise.all([
      import('./firebase'),
      import('./invites'),
      import('./firestore-stats'),
    ])
    const uid = await ensureSignedIn()
    const db = getDb()
    for (const inviteId of waiting) {
      const invite = await invites.readInvite(db, inviteId)
      if (!invite || invite.status !== 'accepted') {
        forgetAcceptedInvite(storage, inviteId)
        continue
      }
      const game = await invites.readInviteGame(db, invite.gameId)
      if (game === 'running') continue
      const counted = game === 'finished' ? await invites.countInvite(db, uid, invite) : null
      if (game === 'finished' && !counted) continue
      forgetAcceptedInvite(storage, inviteId)
      if (!counted) continue
      countedGames += 1
      const unpublished = await publishHighscores(db, counted.result, [counted.row])
      if (unpublished.length > 0) {
        appendPendingHighscores(storage, { result: counted.result, players: unpublished })
      }
    }
  } catch (error) {
    // What didn't go through stays waiting for the next try.
    reportHandledError(error, 'count-accepted-invites')
  }
  return countedGames
}
