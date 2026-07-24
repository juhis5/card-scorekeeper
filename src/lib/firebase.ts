/**
 * Firebase init — app, Firestore, and Anonymous Auth. The web config is public by design
 * (see CLAUDE.md); security is enforced entirely by `firestore.rules`, never by hiding this
 * config. See the firestore-realtime skill and docs/DECISIONS.md's 2026-07-24 online-auth entry:
 * Anonymous Auth's `uid` is the AUTH key Firestore rules check; `device_uuid` (identity store)
 * stays the separate, persistent STATS key.
 *
 * Every real Firebase call (`initializeApp`, `initializeFirestore`, `getAuth`) is deferred to
 * first use via the `getDb()`/`getFirebaseAuth()` getters below, instead of running eagerly at
 * module top level. This is defensive, belt-and-suspenders init (see docs/DECISIONS.md's slice-5
 * offline-robustness entry) — the actual GUARANTEE that a broken/missing `VITE_FIREBASE_*` config
 * degrades the host to a local game is the try/catch around `loadFirebase()` in
 * `useGameConnectivity.ts` (a dynamic `import()` rejects if the imported module throws
 * synchronously while evaluating — confirmed empirically: `getAuth(app)` on a blank config throws
 * `Firebase: Error (auth/invalid-api-key)` synchronously). Keeping this module's own top level
 * free of any Firebase call means merely importing it can never itself crash — only actually
 * calling `getDb()`/`getFirebaseAuth()` can, and every call site is behind that guaranteed catch.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentSingleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const useEmulator = import.meta.env.VITE_USE_EMULATOR === 'true'

let cachedApp: FirebaseApp | undefined

function getFirebaseApp(): FirebaseApp {
  cachedApp ??= initializeApp(firebaseConfig)
  return cachedApp
}

/**
 * True when this browsing context can plausibly support IndexedDB-backed persistence. A
 * synchronous localStorage write/remove is the best signal available before Firestore's own
 * (async, internal) IndexedDB open would fail — constrained storage (iOS Safari PRIVATE mode
 * blocks IndexedDB/localStorage together) throws here too, so this predicts the same failure up
 * front instead of letting `persistentLocalCache` fail into it later, noisily (see
 * docs/DECISIONS.md's slice-5 entry: `Failed to set zombie client id` / `removeItem
 * NS_ERROR_FAILURE` observed in the 4b-ii e2e). Pure + injectable so it's unit-testable without a
 * real browser storage API (see the tdd skill's "mock at the boundary").
 */
export function canUsePersistentCache(
  deps: {
    hasIndexedDb?: () => boolean
    probeLocalStorage?: () => void
  } = {},
): boolean {
  const hasIndexedDb = deps.hasIndexedDb ?? (() => typeof indexedDB !== 'undefined')
  const probeLocalStorage =
    deps.probeLocalStorage ??
    (() => {
      const probeKey = '__firestore_persistence_probe__'
      localStorage.setItem(probeKey, '1')
      localStorage.removeItem(probeKey)
    })

  if (!hasIndexedDb()) return false
  try {
    probeLocalStorage()
    return true
  } catch {
    // Constrained storage (private-mode Safari, cookies/site-data disabled, etc.) — fall back to
    // the memory cache rather than let Firestore's own persistence setup fail into it later.
    return false
  }
}

let cachedDb: Firestore | undefined

/**
 * Lazily initializes Firestore, choosing `persistentLocalCache` — survives brief disconnects mid
 * online-game via cached reads + queued writes (see the firestore-realtime skill's "Offline host
 * mode") — when this context can support it, `memoryLocalCache` otherwise (see
 * `canUsePersistentCache`). Uses `persistentSingleTabManager`, not `persistentMultipleTabManager`:
 * multi-tab sync isn't a real need for a mobile, one-device-per-player card-table app, and
 * dropping it removes the cross-tab "zombie leadership" handshake that was the other source of
 * the persistence noise (see docs/DECISIONS.md) — the trade-off is that a player with the same
 * game open in two tabs on one device won't see the second tab live-update, an accepted edge case.
 */
export function getDb(): Firestore {
  if (cachedDb) return cachedDb
  const localCache = canUsePersistentCache()
    ? persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) })
    : memoryLocalCache()
  cachedDb = initializeFirestore(getFirebaseApp(), { localCache })
  if (useEmulator) {
    // Emulator connection must happen once, before any read/write — gated behind an explicit env
    // flag (off in prod) so slice 4b's dev/e2e workflows can point at local emulators.
    connectFirestoreEmulator(cachedDb, 'localhost', 8280)
  }
  return cachedDb
}

let cachedAuth: Auth | undefined

export function getFirebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth
  cachedAuth = getAuth(getFirebaseApp())
  if (useEmulator) {
    connectAuthEmulator(cachedAuth, 'http://localhost:9299', { disableWarnings: true })
  }
  return cachedAuth
}

// Keyed by Auth instance (not a single module-level variable) so a test spinning up its own
// emulator-connected Auth instance gets its own independent sign-in, never sharing state with
// the app's singleton auth above.
const signInPromises = new WeakMap<Auth, Promise<string>>()

/**
 * Ensures a device has an anonymous auth session, idempotently — `FirestoreGameRepository` must
 * await this (passing its own injected `auth` dep) before its first write (createGame/join/
 * addPlayer) or Firestore rules reject it (every rule requires `request.auth != null`). Safe to
 * call repeatedly and concurrently: an in-flight sign-in promise is reused rather than starting
 * a second one. Defaults to the app's singleton auth (lazily created) for convenience at call
 * sites that don't inject one.
 */
export function ensureSignedIn(authInstance: Auth = getFirebaseAuth()): Promise<string> {
  if (authInstance.currentUser) return Promise.resolve(authInstance.currentUser.uid)
  const existing = signInPromises.get(authInstance)
  if (existing) return existing
  const promise = signInAnonymously(authInstance)
    .then((credential) => credential.user.uid)
    .catch((error: unknown) => {
      signInPromises.delete(authInstance)
      throw error
    })
  signInPromises.set(authInstance, promise)
  return promise
}
