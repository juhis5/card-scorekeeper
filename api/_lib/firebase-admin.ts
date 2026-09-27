/**
 * The only module that touches the Firebase Admin SDK — kept thin and behind plain function
 * signatures so `handler.ts` can be tested against fakes instead of a real service account/
 * Firestore project (see the tdd skill). Admin SDK creds (`FIREBASE_SERVICE_ACCOUNT`) are
 * function-env only, per CLAUDE.md's "Firebase web config is public... the Gemini key is not" —
 * same rule applies to this server-only credential.
 */
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { createRemoteJWKSet } from 'jose'
import { toRoomSnapshot, type RoomSnapshot } from './gate.js'
import { createIdTokenVerifier, FIREBASE_ID_TOKEN_KEYS_URL } from './id-token.js'

/** The downloaded key file's shape: `cert()` accepts it as is, and `project_id` names the
 * project the ID tokens must be issued for. */
interface ServiceAccountKey extends ServiceAccount {
  project_id?: string
}

let cachedServiceAccount: ServiceAccountKey | undefined
let cachedApp: App | undefined
let cachedVerifier: ((idToken: string) => Promise<{ uid: string }>) | undefined

function readServiceAccount(): ServiceAccountKey {
  if (cachedServiceAccount) return cachedServiceAccount
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not set')
  }
  // Never logged — a parse failure here throws a plain SyntaxError with no credential contents.
  // A typed cast (not a runtime shape guard) is enough here: this is an operator-provided env
  // var, not user input — same trust level as the rest of the app's own-written-doc casts (see
  // firestore-repository.ts's `PlayerDocData`/`RoomDocData` casts).
  cachedServiceAccount = JSON.parse(raw) as ServiceAccountKey
  return cachedServiceAccount
}

/** Lazily initializes the Admin app from `FIREBASE_SERVICE_ACCOUNT` (a JSON service-account key,
 * function-env only — never committed, never a `VITE_` var). Reuses an already-initialized app
 * (e.g. a warm Lambda instance) instead of re-initializing, which `initializeApp` would throw on. */
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

/** Verifies a Firebase ID token and returns the caller's uid — the one identity source the gate
 * trusts (see docs/DECISIONS.md's ID-token gate entry). Rejects for any invalid/expired/malformed
 * token; `gate.ts`'s `authenticateRequest` turns that rejection into a clean 401. Checked with
 * `jose` rather than `firebase-admin/auth`, which can't load on Vercel (see `id-token.ts`). */
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

function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp())
}

/**
 * The two Firestore reads layer 2 of the gate needs: the room doc (existence/status/expiry) and
 * this caller's own player doc (room membership) — mapped to the plain `RoomSnapshot` shape
 * `evaluateRoomGate` decides on. The Admin SDK bypasses `firestore.rules` entirely (that's the
 * point — this function IS the trusted server side), so this is the only place allowed to read
 * another player's room membership directly.
 */
export async function getRoomSnapshot(roomCode: string, uid: string): Promise<RoomSnapshot> {
  const db = getAdminFirestore()
  const [roomDoc, playerDoc] = await Promise.all([
    db.doc(`room/${roomCode}`).get(),
    db.doc(`room/${roomCode}/players/${uid}`).get(),
  ])
  return toRoomSnapshot(roomDoc, playerDoc)
}
