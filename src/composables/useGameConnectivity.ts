/**
 * Wires the mode-agnostic connectivity probe + host/join repository factories
 * (`lib/connectivity.ts`, `lib/game-mode.ts`) to this app's real backend (Firebase Auth +
 * Firestore). Kept as the one small seam between them and concrete Firebase/Firestore types so
 * both the host flow (GameSetup) and the join flow (JoinGame) share a single definition of "how
 * do we check reachability and build an online repository" instead of duplicating it — see the
 * clean-code skill's "extract on the second real duplication".
 *
 * Firebase + Firestore (`lib/firebase.ts`, `lib/firestore-repository.ts`) are loaded lazily, on
 * first use, via dynamic `import()` — NOT statically at the top of this file — so that SDK never
 * lands in the app's initial bundle. `HomeView` is eager-loaded (it's the landing route) and
 * renders `GameSetup`/`JoinGame` immediately, so a static import here would force every visitor,
 * including a fully offline host who will never touch the network, to download the Firebase/
 * Firestore SDK before the home screen even paints — directly against CLAUDE.md's
 * "offline-capable host" golden rule and the mobile-first requirement (a card table is exactly
 * where connectivity is least reliable). The lazy import costs one dynamic fetch the first time a
 * player actually submits the host/join form; `lib/local-repository.ts` and the pure
 * `lib/connectivity.ts`/`lib/game-mode.ts` stay static since they carry no such weight.
 *
 * **Golden-rule fix (docs/DECISIONS.md's slice-5 offline-robustness entry):** `loadFirebase()` can
 * fail in ways that have nothing to do with reachability — the dynamic `import()` itself
 * rejecting (no network to fetch the Firebase/Firestore SDK chunk), or `getFirebaseAuth()`/
 * `getDb()` throwing synchronously on a broken/missing `VITE_FIREBASE_*` config (confirmed
 * empirically: a blank API key throws `Firebase: Error (auth/invalid-api-key)` the instant
 * `getAuth()` runs). Before this fix, either of those rejected `hostRepository()`'s whole promise,
 * so "Start game" surfaced a raw error instead of ever reaching `createHostRepository`'s own
 * reachable/unreachable branching — a broken config crashed the offline-capable host, exactly the
 * failure CLAUDE.md's golden rule forbids. Both functions below now wrap the entire
 * `loadFirebase()` + factory call in a try/catch so ANY such failure degrades the same way an
 * unreachable backend already does: host → local game, join → the existing friendly error.
 *
 * A plain composable (no reactive state of its own) — tests mock this whole module rather than
 * the Firebase/Firestore modules it wires together (see the tdd skill's "mock at the boundary").
 */
import { probeBackendReachable } from '@/lib/connectivity'
import { createHostRepository, createJoinRepository } from '@/lib/game-mode'
import type { HostGameMode, JoinGameMode } from '@/lib/game-mode'
import { LocalGameRepository } from '@/lib/local-repository'

async function loadFirebase() {
  const [{ getFirebaseAuth, getDb, ensureSignedIn }, { FirestoreGameRepository }] =
    await Promise.all([import('@/lib/firebase'), import('@/lib/firestore-repository')])
  // Calling the getters here (not passing them through unevaluated) means a bad config's
  // synchronous throw happens inside this async function — i.e. as a rejection of the promise
  // both callers below already wrap in try/catch — rather than leaking a raw exception.
  return { auth: getFirebaseAuth(), db: getDb(), ensureSignedIn, FirestoreGameRepository }
}

export function useGameConnectivity() {
  /** Host path: reachable → a fresh Firestore room; unreachable OR any online-setup failure → a
   * local single-device game (see the file-level "golden-rule fix" comment above). */
  async function hostRepository(): Promise<HostGameMode> {
    try {
      const { auth, db, ensureSignedIn, FirestoreGameRepository } = await loadFirebase()
      return await createHostRepository({
        // Anonymous sign-in doubles as the lightweight "can we reach the backend" check —
        // resolving means Firebase Auth answered, rejecting/hanging means unreachable (see
        // connectivity.ts).
        probeBackendReachable: () =>
          probeBackendReachable({ checkBackend: () => ensureSignedIn(auth) }),
        createOnlineRepository: () => new FirestoreGameRepository({ db, auth }),
        createLocalRepository: () => new LocalGameRepository(),
      })
    } catch {
      // loadFirebase() itself failed — never reached the probe at all. Degrade exactly like an
      // unreachable backend: the host must never see "Start game" fail outright.
      return { kind: 'offline', repository: new LocalGameRepository() }
    }
  }

  /** Join path: online only — there is no local room to join by code, so any failure (including
   * loadFirebase() itself failing) collapses to the same friendly "unreachable" outcome. */
  async function joinRepository(roomCode: string): Promise<JoinGameMode> {
    try {
      const { auth, db, ensureSignedIn, FirestoreGameRepository } = await loadFirebase()
      return await createJoinRepository({
        probeBackendReachable: () =>
          probeBackendReachable({ checkBackend: () => ensureSignedIn(auth) }),
        createOnlineRepository: () => new FirestoreGameRepository({ db, auth, roomCode }),
      })
    } catch {
      return { kind: 'unreachable' }
    }
  }

  return { hostRepository, joinRepository }
}
