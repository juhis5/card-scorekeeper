/**
 * The room-gated access-control decisions (layers 1 + 2 of the vercel-gemini skill's "layered
 * protection"). Every function here is pure — the caller does the actual Admin SDK I/O
 * (`verifyIdToken`, Firestore reads) and passes plain data in, so the decision logic itself is a
 * one-line-per-case unit test with no mocking of the SDKs (see the tdd skill).
 *
 * Identity model (see docs/DECISIONS.md's 2026-07-24 ID-token gate entry): the caller's identity
 * is their Firebase ID token, verified server-side by the Admin SDK — never a self-asserted field
 * in the request body, which would be forgeable.
 */

export type AuthResult = { ok: true; uid: string } | { ok: false }

/**
 * Verifies the caller's Firebase ID token via the injected `verifyIdToken` (the Admin SDK call —
 * kept as a parameter so this stays unit-testable without a real Firebase project). No token, or
 * an `auth/...` rejection (invalid, expired, malformed), is the caller's problem: `{ ok: false }`,
 * which the handler maps to 401. Anything else (e.g. missing server credentials) is rethrown, so
 * a misconfigured deploy shows up as a 500 in the logs instead of looking like a bad token.
 */
export async function authenticateRequest(
  token: string | null,
  verifyIdToken: (idToken: string) => Promise<{ uid: string }>,
): Promise<AuthResult> {
  if (!token) return { ok: false }
  try {
    const decoded = await verifyIdToken(token)
    return { ok: true, uid: decoded.uid }
  } catch (error) {
    if (isFirebaseAuthError(error)) return { ok: false }
    throw error
  }
}

function isFirebaseAuthError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const { code } = error as { code: unknown }
  return typeof code === 'string' && code.startsWith('auth/')
}

export type RoomStatus = 'waiting' | 'playing' | 'finished'

/** Plain data the caller assembles from Firestore reads — see `firebase-admin.ts`'s
 * `getRoomSnapshot` for how this is built from real Admin SDK documents. */
export interface RoomSnapshot {
  exists: boolean
  status: RoomStatus | null
  expiresAtMs: number | null
  /** Whether the authenticated caller (`room/{roomCode}/players/{uid}`) is seated in this room. */
  isMember: boolean
}

export type RoomGateFailureReason = 'not-found' | 'finished' | 'expired' | 'not-member'
export type RoomGateResult = { ok: true } | { ok: false; reason: RoomGateFailureReason }

/**
 * Layer 2 of the gate: the room must exist, be an active game (not finished, not expired), and
 * the caller must be one of its seated players. Any failure → the handler's 403 (see
 * docs/PLAN.md "Protecting your Gemini free tier" — "random pokes with no valid room are
 * rejected").
 */
export function evaluateRoomGate(room: RoomSnapshot, nowMs: number): RoomGateResult {
  if (!room.exists) return { ok: false, reason: 'not-found' }
  if (room.status === 'finished') return { ok: false, reason: 'finished' }
  if (room.expiresAtMs === null || room.expiresAtMs <= nowMs) {
    return { ok: false, reason: 'expired' }
  }
  if (!room.isMember) return { ok: false, reason: 'not-member' }
  return { ok: true }
}

/** The room fields this gate reads — mirrors `firestore-repository.ts`'s `RoomDocData` (same
 * `room/{code}` doc, written by that class; this is the Admin SDK's read side of it). */
interface RoomDocFields {
  status: RoomStatus
  expiresAt: { toMillis(): number }
}

/** Structural subset of a `firebase-admin/firestore` `DocumentSnapshot` — real Admin SDK
 * snapshots satisfy this without adaptation (`data()` there returns the SDK's own loosely-typed
 * `DocumentData`, narrowed below the same way `firestore-repository.ts` narrows the client SDK's
 * equivalent — a typed cast, not a runtime shape guard: this app writes these docs itself, see
 * that file's own `RoomDocData`/`PlayerDocData` casts for the precedent). Tests can pass plain
 * object literals instead of mocking the SDK (see `firebase-admin.ts`'s `getRoomSnapshot`). */
export interface RoomDocLike {
  exists: boolean
  data(): Record<string, unknown> | undefined
}
export interface PlayerDocLike {
  exists: boolean
}

/** Maps the two Firestore reads `getRoomSnapshot` performs (the room doc + this caller's player
 * doc) into the plain `RoomSnapshot` `evaluateRoomGate` decides on. Pure — no Firestore calls. */
export function toRoomSnapshot(roomDoc: RoomDocLike, playerDoc: PlayerDocLike): RoomSnapshot {
  if (!roomDoc.exists) {
    return { exists: false, status: null, expiresAtMs: null, isMember: false }
  }
  // The Admin SDK types data() as DocumentData; the fields are checked below before use.
  const data = roomDoc.data() as unknown as RoomDocFields | undefined
  return {
    exists: true,
    status: data?.status ?? null,
    expiresAtMs: data ? data.expiresAt.toMillis() : null,
    isMember: playerDoc.exists,
  }
}
