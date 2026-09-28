// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { authenticateRequest, evaluateRoomGate, toRoomSnapshot, type RoomSnapshot } from './gate'

describe('authenticateRequest', () => {
  it('rejects when no token was provided', async () => {
    const verifyIdToken = vi.fn()
    const result = await authenticateRequest(null, verifyIdToken)
    expect(result).toEqual({ ok: false })
    expect(verifyIdToken).not.toHaveBeenCalled()
  })

  it('returns the uid for a token the Admin SDK verifies', async () => {
    const verifyIdToken = vi.fn().mockResolvedValue({ uid: 'player-1' })
    const result = await authenticateRequest('a-valid-token', verifyIdToken)
    expect(result).toEqual({ ok: true, uid: 'player-1' })
    expect(verifyIdToken).toHaveBeenCalledWith('a-valid-token')
  })

  it('rejects when the Admin SDK rejects the token (invalid/expired)', async () => {
    const verifyIdToken = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('invalid token'), { code: 'auth/id-token-expired' }),
      )
    const result = await authenticateRequest('a-bad-token', verifyIdToken)
    expect(result).toEqual({ ok: false })
  })

  it('rethrows a server-side failure instead of blaming the caller', async () => {
    const verifyIdToken = vi
      .fn()
      .mockRejectedValue(new Error('FIREBASE_SERVICE_ACCOUNT is not set'))

    await expect(authenticateRequest('a-token', verifyIdToken)).rejects.toThrow(
      'FIREBASE_SERVICE_ACCOUNT is not set',
    )
  })
})

describe('evaluateRoomGate', () => {
  const nowMs = 1_000_000

  const activeRoom: RoomSnapshot = {
    exists: true,
    status: 'playing',
    expiresAtMs: nowMs + 1,
    isMember: true,
  }

  it('allows an active room the caller is seated in', () => {
    expect(evaluateRoomGate(activeRoom, nowMs)).toEqual({ ok: true })
  })

  it('rejects a room that does not exist', () => {
    const room: RoomSnapshot = { exists: false, status: null, expiresAtMs: null, isMember: false }
    expect(evaluateRoomGate(room, nowMs)).toEqual({ ok: false, reason: 'not-found' })
  })

  it('rejects a finished room', () => {
    const room: RoomSnapshot = { ...activeRoom, status: 'finished' }
    expect(evaluateRoomGate(room, nowMs)).toEqual({ ok: false, reason: 'finished' })
  })

  it('rejects a room the host ended early', () => {
    const room: RoomSnapshot = { ...activeRoom, status: 'abandoned' }
    expect(evaluateRoomGate(room, nowMs)).toEqual({ ok: false, reason: 'finished' })
  })

  it('rejects an expired room', () => {
    const room: RoomSnapshot = { ...activeRoom, expiresAtMs: nowMs - 1 }
    expect(evaluateRoomGate(room, nowMs)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a room expiring exactly now', () => {
    const room: RoomSnapshot = { ...activeRoom, expiresAtMs: nowMs }
    expect(evaluateRoomGate(room, nowMs)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a caller who is not a seated member of an otherwise-active room', () => {
    const room: RoomSnapshot = { ...activeRoom, isMember: false }
    expect(evaluateRoomGate(room, nowMs)).toEqual({ ok: false, reason: 'not-member' })
  })
})

describe('toRoomSnapshot', () => {
  it('maps a non-existent room doc without reading player membership', () => {
    const roomDoc = { exists: false, data: () => undefined }
    const playerDoc = { exists: false }
    expect(toRoomSnapshot(roomDoc, playerDoc)).toEqual({
      exists: false,
      status: null,
      expiresAtMs: null,
      isMember: false,
    })
  })

  it('maps an existing room doc + a seated player doc', () => {
    const roomDoc = {
      exists: true,
      data: () => ({ status: 'playing' as const, expiresAt: { toMillis: () => 42 } }),
    }
    const playerDoc = { exists: true }
    expect(toRoomSnapshot(roomDoc, playerDoc)).toEqual({
      exists: true,
      status: 'playing',
      expiresAtMs: 42,
      isMember: true,
    })
  })

  it('maps an existing room doc + a caller who is not seated', () => {
    const roomDoc = {
      exists: true,
      data: () => ({ status: 'waiting' as const, expiresAt: { toMillis: () => 42 } }),
    }
    const playerDoc = { exists: false }
    expect(toRoomSnapshot(roomDoc, playerDoc).isMember).toBe(false)
  })

  it('maps a room doc that exists but has no data as having no status or expiry', () => {
    const roomDoc = { exists: true, data: () => undefined }
    const playerDoc = { exists: true }
    expect(toRoomSnapshot(roomDoc, playerDoc)).toEqual({
      exists: true,
      status: null,
      expiresAtMs: null,
      isMember: true,
    })
  })
})
