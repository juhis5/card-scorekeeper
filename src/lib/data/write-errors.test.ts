import { describe, expect, it } from 'vitest'
import { isPermanentWriteError, isPermissionDenied, isUnavailable } from './write-errors'

function firestoreError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

describe('isUnavailable', () => {
  it.each(['unavailable', 'deadline-exceeded'])(
    'treats %s as unreachable: worth retrying once back online',
    (code) => {
      expect(isUnavailable(firestoreError(code))).toBe(true)
    },
  )

  it('is false for a rejection from the server, which retrying will not fix', () => {
    expect(isUnavailable(firestoreError('permission-denied'))).toBe(false)
  })

  it('is false for values without a string code', () => {
    expect(isUnavailable(new Error('offline'))).toBe(false)
    expect(isUnavailable({ code: 14 })).toBe(false)
    expect(isUnavailable(undefined)).toBe(false)
  })
})

describe('isPermissionDenied', () => {
  it('recognises the permission-denied code Firestore rejects a write with', () => {
    expect(isPermissionDenied(firestoreError('permission-denied'))).toBe(true)
  })

  it('is false for other codes and for values without a code', () => {
    expect(isPermissionDenied(firestoreError('unavailable'))).toBe(false)
    expect(isPermissionDenied(new Error('offline'))).toBe(false)
    expect(isPermissionDenied('permission-denied')).toBe(false)
    expect(isPermissionDenied(null)).toBe(false)
  })
})

describe('isPermanentWriteError', () => {
  it.each(['permission-denied', 'invalid-argument', 'failed-precondition', 'out-of-range'])(
    'treats %s as permanent: retrying the same write can never succeed',
    (code) => {
      expect(isPermanentWriteError(firestoreError(code))).toBe(true)
    },
  )

  it.each(['unavailable', 'deadline-exceeded', 'unauthenticated', 'resource-exhausted'])(
    'treats %s as transient: the same write may succeed later',
    (code) => {
      expect(isPermanentWriteError(firestoreError(code))).toBe(false)
    },
  )

  it('treats an error without a Firestore code as transient', () => {
    expect(isPermanentWriteError(new Error('Failed to fetch'))).toBe(false)
  })
})
