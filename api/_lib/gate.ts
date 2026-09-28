/**
 * The access decisions: the caller's ID token, then the room. The caller does the I/O and passes
 * plain data in. Identity comes only from the verified token, never from the request body.
 */

import { isGameOver } from '../../src/lib/game/rules.js'
import type { GameStatus } from '../../src/lib/game/types.js'

export type AuthResult = { ok: true; uid: string } | { ok: false }

/** No token, or an `auth/...` rejection (invalid, expired, malformed), is `{ ok: false }`, a 401.
 * Anything else, such as missing server credentials, is rethrown, so a broken deploy shows up as a
 * logged 500 instead of looking like a bad token. */
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

export type RoomStatus = GameStatus

/** Built from the Firestore reads by `getRoomSnapshot`. */
export interface RoomSnapshot {
  exists: boolean
  status: RoomStatus | null
  expiresAtMs: number | null
  /** Whether the caller has a seat in this room. */
  isMember: boolean
}

export type RoomGateFailureReason = 'not-found' | 'finished' | 'expired' | 'not-member'
export type RoomGateResult = { ok: true } | { ok: false; reason: RoomGateFailureReason }

/** The room must exist, be live (not finished, ended early or expired) and have the caller
 * seated. Any failure is a 403. */
export function evaluateRoomGate(room: RoomSnapshot, nowMs: number): RoomGateResult {
  if (!room.exists) return { ok: false, reason: 'not-found' }
  if (room.status !== null && isGameOver(room.status)) return { ok: false, reason: 'finished' }
  if (room.expiresAtMs === null || room.expiresAtMs <= nowMs) {
    return { ok: false, reason: 'expired' }
  }
  if (!room.isMember) return { ok: false, reason: 'not-member' }
  return { ok: true }
}

/** The room fields read here, as `firestore-repository.ts` writes them. */
interface RoomDocFields {
  status: RoomStatus
  expiresAt: { toMillis(): number }
}

/** The part of an Admin SDK `DocumentSnapshot` used here, so tests can pass plain objects. */
export interface RoomDocLike {
  exists: boolean
  data(): Record<string, unknown> | undefined
}
export interface PlayerDocLike {
  exists: boolean
}

export function toRoomSnapshot(roomDoc: RoomDocLike, playerDoc: PlayerDocLike): RoomSnapshot {
  if (!roomDoc.exists) {
    return { exists: false, status: null, expiresAtMs: null, isMember: false }
  }
  // A cast, not a shape guard: the app writes these docs itself.
  const data = roomDoc.data() as unknown as RoomDocFields | undefined
  return {
    exists: true,
    status: data?.status ?? null,
    expiresAtMs: data ? data.expiresAt.toMillis() : null,
    isMember: playerDoc.exists,
  }
}
