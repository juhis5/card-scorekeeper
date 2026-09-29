/**
 * The only module that touches the Firebase Admin SDK, behind plain functions so `handler.ts` can
 * be tested with fakes. `FIREBASE_SERVICE_ACCOUNT` is a server-only secret, like the Gemini key.
 */
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { createRemoteJWKSet } from 'jose'
import { toRoomSnapshot, type RoomSnapshot } from './gate.js'
import { APP_CHECK_KEYS_URL, createAppCheckVerifier } from './app-check-token.js'
import { createIdTokenVerifier, FIREBASE_ID_TOKEN_KEYS_URL } from './id-token.js'

/** The downloaded key file's shape: `cert()` accepts it as is, and `project_id` names the
 * project the ID tokens must be issued for. */
interface ServiceAccountKey extends ServiceAccount {
  project_id?: string
}

let cachedServiceAccount: ServiceAccountKey | undefined
let cachedApp: App | undefined
let cachedVerifier: ((idToken: string) => Promise<{ uid: string }>) | undefined
let cachedAppCheckVerifier: ((token: string) => Promise<void>) | undefined

function readServiceAccount(): ServiceAccountKey {
  if (cachedServiceAccount) return cachedServiceAccount
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not set')
  }
  // A cast, not a shape guard: the operator sets this env var, it isn't user input. A parse error
  // is replaced, not wrapped: V8's message quotes the input around the bad token, and this one
  // holds the private key, which must never reach the logs.
  try {
    cachedServiceAccount = JSON.parse(raw) as ServiceAccountKey
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON')
  }
  return cachedServiceAccount
}

/** Initializes the Admin app once, reusing the one a warm instance already has (a second
 * `initializeApp` would throw). */
export function getAdminApp(): App {
  if (cachedApp) return cachedApp
  const existing = getApps()[0]
  if (existing) {
    cachedApp = existing
    return cachedApp
  }

  cachedApp = initializeApp({ credential: cert(readServiceAccount()) })
  return cachedApp
}

/** The caller's uid from a verified Firebase ID token, the only identity the gate trusts. A bad
 * token rejects, which `authenticateRequest` turns into a 401. Uses `jose`, because
 * `firebase-admin/auth` can't load on Vercel (see `id-token.ts`). */
export async function verifyIdToken(idToken: string): Promise<{ uid: string }> {
  if (!cachedVerifier) {
    const projectId = readServiceAccount().project_id
    if (!projectId) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT has no project_id')
    }
    // Module-scoped, so warm invocations reuse the fetched keys (jose caches and refreshes them).
    cachedVerifier = createIdTokenVerifier({
      projectId,
      keys: createRemoteJWKSet(new URL(FIREBASE_ID_TOKEN_KEYS_URL)),
    })
  }
  return cachedVerifier(idToken)
}

/** Rejects unless the token proves the request comes from this project's own app. The project
 * number is the web config's messaging sender id, which the function's env has anyway. */
export async function verifyAppCheckToken(token: string): Promise<void> {
  if (!cachedAppCheckVerifier) {
    const projectNumber = process.env.VITE_FIREBASE_MESSAGING_SENDER_ID
    if (!projectNumber) {
      throw new Error('VITE_FIREBASE_MESSAGING_SENDER_ID is not set')
    }
    cachedAppCheckVerifier = createAppCheckVerifier({
      projectNumber,
      keys: createRemoteJWKSet(new URL(APP_CHECK_KEYS_URL)),
    })
  }
  return cachedAppCheckVerifier(token)
}

function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp())
}

/** The two reads the room gate needs: the room doc and the caller's own player doc. The Admin SDK
 * bypasses `firestore.rules`; this is the trusted server side. */
export async function getRoomSnapshot(roomCode: string, uid: string): Promise<RoomSnapshot> {
  const db = getAdminFirestore()
  const [roomDoc, playerDoc] = await Promise.all([
    db.doc(`room/${roomCode}`).get(),
    db.doc(`room/${roomCode}/players/${uid}`).get(),
  ])
  return toRoomSnapshot(roomDoc, playerDoc)
}
