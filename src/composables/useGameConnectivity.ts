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
 * A plain composable (no reactive state of its own) — tests mock this whole module rather than
 * the Firebase/Firestore modules it wires together (see the tdd skill's "mock at the boundary").
 */
import { probeBackendReachable } from '@/lib/connectivity'
import { createHostRepository, createJoinRepository } from '@/lib/game-mode'
import type { HostGameMode, JoinGameMode } from '@/lib/game-mode'
import { LocalGameRepository } from '@/lib/local-repository'

async function loadFirebase() {
  const [{ auth, db, ensureSignedIn }, { FirestoreGameRepository }] = await Promise.all([
    import('@/lib/firebase'),
    import('@/lib/firestore-repository'),
  ])
  return { auth, db, ensureSignedIn, FirestoreGameRepository }
}

export function useGameConnectivity() {
  /** Host path: reachable → a fresh Firestore room; unreachable → a local single-device game. */
  function hostRepository(): Promise<HostGameMode> {
    return loadFirebase().then(({ auth, db, ensureSignedIn, FirestoreGameRepository }) =>
      createHostRepository({
        // Anonymous sign-in doubles as the lightweight "can we reach the backend" check —
        // resolving means Firebase Auth answered, rejecting/hanging means unreachable (see
        // connectivity.ts).
        probeBackendReachable: () =>
          probeBackendReachable({ checkBackend: () => ensureSignedIn(auth) }),
        createOnlineRepository: () => new FirestoreGameRepository({ db, auth }),
        createLocalRepository: () => new LocalGameRepository(),
      }),
    )
  }

  /** Join path: online only — there is no local room to join by code. */
  function joinRepository(roomCode: string): Promise<JoinGameMode> {
    return loadFirebase().then(({ auth, db, ensureSignedIn, FirestoreGameRepository }) =>
      createJoinRepository({
        probeBackendReachable: () =>
          probeBackendReachable({ checkBackend: () => ensureSignedIn(auth) }),
        createOnlineRepository: () => new FirestoreGameRepository({ db, auth, roomCode }),
      }),
    )
  }

  return { hostRepository, joinRepository }
}
