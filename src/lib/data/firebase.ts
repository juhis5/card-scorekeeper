/**
 * The web config is public; firestore.rules is the security. No Firebase call runs at import, as
 * getAuth() throws synchronously on a blank config. Only the getters can throw, inside callers'
 * catches (useGameConnectivity.ts falls back to local play).
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentSingleTabManager,
  type Firestore,
} from 'firebase/firestore'
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  signInAnonymously,
  type Auth,
} from 'firebase/auth'

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

/** A synchronous localStorage write is the best early sign that IndexedDB persistence will work.
 * Constrained storage (iOS Safari private mode) throws here instead of failing noisily later. */
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
    return false
  }
}

let cachedDb: Firestore | undefined

/**
 * The persistent cache rides out brief disconnects mid-game. Single-tab, since a phone at the table
 * needs no multi-tab sync and its cross-tab leadership handshake was noisy. The cost: a second tab
 * of the same game on one device doesn't live-update.
 */
export function getDb(): Firestore {
  if (cachedDb) return cachedDb
  const localCache = canUsePersistentCache()
    ? persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) })
    : memoryLocalCache()
  cachedDb = initializeFirestore(getFirebaseApp(), { localCache })
  if (useEmulator) {
    // Must connect before any read or write.
    connectFirestoreEmulator(cachedDb, 'localhost', 8280)
  }
  return cachedDb
}

let cachedAuth: Auth | undefined

export function getFirebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth
  // getAuth's defaults, spelled out. The resolver is what Google sign-in's popup needs. Phones and
  // Safari only open a popup soon after the tap, so on those the SDK loads Google's script and auth
  // iframe here, up front. If they fail to load, anonymous sign-in carries on without them.
  cachedAuth = initializeAuth(getFirebaseApp(), {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  })
  if (useEmulator) {
    connectAuthEmulator(cachedAuth, 'http://localhost:9299', { disableWarnings: true })
  }
  return cachedAuth
}

// Per Auth instance, so a test's own emulator Auth never shares sign-in state with the app's.
const signInPromises = new WeakMap<Auth, Promise<string>>()

/** Every rule needs `request.auth`, so await this before the first write. Concurrent calls share
 * the sign-in in flight. */
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

/** Never a real room code (lowercase is outside the room-code alphabet). Not `__probe__`:
 * Firestore rejects document ids matching `__.*__` as invalid, which would fail every probe. */
const REACHABILITY_PROBE_PATH = 'room/probe'

/**
 * Signing in isn't enough: a cached session restores with no network, so on Wi-Fi without internet
 * it passes and the first write hangs. A server read proves Firestore answers. The rules let any
 * signed-in user get one room doc, even a missing one.
 */
export async function checkBackendReachable(authInstance: Auth, db: Firestore): Promise<void> {
  await ensureSignedIn(authInstance)
  await getDocFromServer(doc(db, REACHABILITY_PROBE_PATH))
}
