/**
 * The only module that touches the Firebase Admin SDK — kept thin and behind plain function
 * signatures so `handler.ts` can be tested against fakes instead of a real service account/
 * Firestore project (see the tdd skill). Admin SDK creds (`FIREBASE_SERVICE_ACCOUNT`) are
 * function-env only, per CLAUDE.md's "Firebase web config is public... the Gemini key is not" —
 * same rule applies to this server-only credential.
 */
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { toRoomSnapshot, type RoomSnapshot } from './gate'

let cachedApp: App | undefined

/** Lazily initializes the Admin app from `FIREBASE_SERVICE_ACCOUNT` (a JSON service-account key,
 * function-env only — never committed, never a `VITE_` var). Reuses an already-initialized app
 * (e.g. a warm Lambda instance) instead of re-initializing, which `initializeApp` would throw on. */
function getAdminApp(): App {
  if (cachedApp) return cachedApp
  const existing = getApps()[0]
  if (existing) {
    cachedApp = existing
    return cachedApp
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not set')
  }
  // Never logged — a parse failure here throws a plain SyntaxError with no credential contents.
  // A typed cast (not a runtime shape guard) is enough here: this is an operator-provided env
  // var, not user input — same trust level as the rest of the app's own-written-doc casts (see
  // firestore-repository.ts's `PlayerDocData`/`RoomDocData` casts).
  const serviceAccount = JSON.parse(raw) as ServiceAccount
  cachedApp = initializeApp({ credential: cert(serviceAccount) })
  return cachedApp
}

/** Verifies a Firebase ID token and returns the caller's uid — the one identity source the gate
 * trusts (see docs/DECISIONS.md's ID-token gate entry). Rejects for any invalid/expired/malformed
 * token; `gate.ts`'s `authenticateRequest` turns that rejection into a clean 401. */
export async function verifyIdToken(idToken: string): Promise<{ uid: string }> {
  const decoded = await getAuth(getAdminApp()).verifyIdToken(idToken)
  return { uid: decoded.uid }
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
