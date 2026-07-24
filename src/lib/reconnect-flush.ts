/**
 * App-bootstrap wiring for the reconnect flush (docs/PLAN.md "Reconnect = push final result
 * only", docs/DECISIONS.md's offline entries): on launch, if the device is online, push any
 * `LocalGameRepository`-queued finished-game results up to Firestore.
 *
 * This file is intentionally thin glue — the actual flush LOGIC (read the queue, call the
 * writer, clear only what succeeded) lives in `pending-results.ts`'s `flushPendingResults` and is
 * unit-tested there against a mock writer, per the tdd skill's "mock at the boundary". This file
 * only assembles the real writer (Firestore + anonymous auth) and calls it — nothing here needs
 * its own test beyond a smoke check that it never throws.
 *
 * Firebase/Firestore are loaded lazily via dynamic `import()`, the same reason as
 * `useGameConnectivity.ts`: an offline host must never pay for the Firebase SDK in their initial
 * bundle just because this call exists on the launch path.
 *
 * `deviceUuid` on the queued row(s) is overwritten with the flusher's own freshly-signed-in auth
 * uid before writing — see docs/DECISIONS.md's forgery-fix entry. `firestore.rules`' local-path
 * (no-room) `game_player` create rule requires `deviceUuid == request.auth.uid` (a self-write
 * only, since there's no room to check a participant against); whatever `LocalGameRepository`
 * queued (the host's own localStorage `device_uuid`, at the time the game finished, possibly
 * offline) is not necessarily that — only the uid this device is ACTUALLY signed in as, right
 * now, at flush time, can satisfy the rule.
 */
import { browserLocalStorage } from './key-value-storage'
import { flushPendingResults } from './pending-results'

/** Best-effort: any failure (still offline after all, a broken config, a write rejected) just
 * means the queued result(s) stay queued for the next launch — never surfaced to the user, never
 * allowed to block or delay app startup (see the offline-capable host golden rule). */
export async function flushPendingResultsOnLaunch(): Promise<void> {
  try {
    const [{ getDb, getFirebaseAuth, ensureSignedIn }, { writeGameResult }] = await Promise.all([
      import('./firebase'),
      import('./firestore-stats'),
    ])
    const auth = getFirebaseAuth()
    const db = getDb()

    await flushPendingResults(browserLocalStorage(), {
      write: async (entry) => {
        const uid = await ensureSignedIn(auth)
        // See the file-level doc comment: the rule can only ever authorize self-write on this
        // path, so the row must carry the CURRENT auth uid, not whatever was queued offline.
        const players = entry.players.map((player) => ({ ...player, deviceUuid: uid }))
        await writeGameResult(db, entry.result, players)
      },
    })
  } catch {
    // Swallowed deliberately — see the doc comment above.
  }
}
