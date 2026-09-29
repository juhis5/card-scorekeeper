/**
 * The web config is public; firestore.rules is the security. No Firebase call runs at import, as
 * getAuth() throws synchronously on a blank config. Only the getters can throw, inside callers'
 * catches (useGameConnectivity.ts falls back to local play).
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check'
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

/** App Check's reCAPTCHA Enterprise site key, public like the rest of the web config. Unset
 * (local, CI, the emulators): App Check stays off, and so does its enforcement in `/api/count`. */
const appCheckSiteKey = import.meta.env.VITE_APP_CHECK_SITE_KEY

let cachedApp: FirebaseApp | undefined
let cachedAppCheck: AppCheck | undefined

function getFirebaseApp(): FirebaseApp {
  if (cachedApp) return cachedApp
  cachedApp = initializeApp(firebaseConfig)
  if (appCheckSiteKey && !useEmulator) {
    // Before any Firestore or Auth call, so each of them carries a token. A development build
    // against staging needs a debug token registered in the console (docs/RELEASE.md).
    const debugToken = import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN
    if (debugToken) {
      ;(globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
        debugToken
    }
    cachedAppCheck = initializeAppCheck(cachedApp, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
  }
  return cachedApp
}

/** For our own backend (`/api/count`), which checks it itself. Null while App Check is off. */
export async function getAppCheckToken(): Promise<string | null> {
  getFirebaseApp()
  if (!cachedAppCheck) return null
  return (await getToken(cachedAppCheck)).token
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
export async function ensureSignedIn(authInstance: Auth = getFirebaseAuth()): Promise<string> {
  // The saved session restores asynchronously, so until then there's no user even for a player
  // who signed in with Google, and signInAnonymously would replace their account with a new one.
  await authInstance.authStateReady()
  if (authInstance.currentUser) return authInstance.currentUser.uid
  const existing = signInPromises.get(authInstance)
  if (existing) return existing
  // Forgotten once settled: after a sign-out the next call signs in afresh.
  const promise = signInAnonymously(authInstance)
    .then((credential) => credential.user.uid)
    .finally(() => signInPromises.delete(authInstance))
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
