/**
 * Firebase init — app, Firestore, and Anonymous Auth. The web config is public by design
 * (see CLAUDE.md); security is enforced entirely by `firestore.rules`, never by hiding this
 * config. See the firestore-realtime skill and docs/DECISIONS.md's 2026-07-24 online-auth entry:
 * Anonymous Auth's `uid` is the AUTH key Firestore rules check; `device_uuid` (identity store)
 * stays the separate, persistent STATS key.
 */
import { initializeApp } from 'firebase/app'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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

const app = initializeApp(firebaseConfig)

// `persistentLocalCache` (rather than the default memory cache) covers brief disconnects mid
// online-game — cached reads + queued writes that flush on reconnect — separate from offline
// host mode's LocalGameRepository. See the firestore-realtime skill's "Offline host mode".
// `persistentMultipleTabManager` lets a player with the game open in two tabs share the cache
// instead of fighting over it.
export const db: Firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})
export const auth: Auth = getAuth(app)

if (import.meta.env.VITE_USE_EMULATOR === 'true') {
  // Emulator connection must happen once, before any read/write — gated behind an explicit env
  // flag (off in prod) so slice 4b's dev/e2e workflows can point at local emulators.
  connectFirestoreEmulator(db, 'localhost', 8280)
  connectAuthEmulator(auth, 'http://localhost:9299', { disableWarnings: true })
}

// Keyed by Auth instance (not a single module-level variable) so a test spinning up its own
// emulator-connected Auth instance gets its own independent sign-in, never sharing state with
// the app's singleton `auth` above.
const signInPromises = new WeakMap<Auth, Promise<string>>()

/**
 * Ensures a device has an anonymous auth session, idempotently — `FirestoreGameRepository` must
 * await this (passing its own injected `auth` dep) before its first write (createGame/join/
 * addPlayer) or Firestore rules reject it (every rule requires `request.auth != null`). Safe to
 * call repeatedly and concurrently: an in-flight sign-in promise is reused rather than starting
 * a second one. Defaults to the app's singleton `auth` for convenience at call sites that don't
 * inject one.
 */
export function ensureSignedIn(authInstance: Auth = auth): Promise<string> {
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
