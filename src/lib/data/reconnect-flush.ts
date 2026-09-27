/** On launch, uploads finished local games queued offline. The logic is in pending-results.ts;
 * this wires the real writer. Firebase loads lazily so an offline host never downloads it. */
import { browserLocalStorage } from './key-value-storage'
import { flushPendingResults, readPendingResults } from './pending-results'

/** Best-effort: on any failure the results stay queued for the next launch. Never blocks startup
 * or shows an error. */
export async function flushPendingResultsOnLaunch(): Promise<void> {
  try {
    // Most launches have nothing queued: skip loading Firebase.
    if (readPendingResults(browserLocalStorage()).length === 0) return
    const [{ getDb, getFirebaseAuth, ensureSignedIn }, { writeGameResult }] = await Promise.all([
      import('./firebase'),
      import('./firestore-stats'),
    ])
    const auth = getFirebaseAuth()
    const db = getDb()

    await flushPendingResults(browserLocalStorage(), {
      write: async (entry) => {
        const uid = await ensureSignedIn(auth)
        // The no-room game_player rule accepts only a self-write (deviceUuid == auth.uid), so
        // stamp the uid signed in now, not whatever was queued offline.
        const players = entry.players.map((player) => ({ ...player, deviceUuid: uid }))
        await writeGameResult(db, entry.result, players)
      },
    })
  } catch {
    // Stays queued for the next launch.
  }
}
