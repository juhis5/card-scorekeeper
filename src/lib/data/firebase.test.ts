import { describe, expect, it } from 'vitest'
import { canUsePersistentCache } from './firebase'

/**
 * `canUsePersistentCache` is the pure decision `getDb()` (in this file) uses to pick
 * `persistentLocalCache` vs `memoryLocalCache` — see the slice-5 offline-robustness entry in
 * docs/DECISIONS.md. Tested here with fully injected deps so this never touches a real
 * IndexedDB/localStorage (see the tdd skill: no real browser storage in a unit test). Importing
 * `canUsePersistentCache` alone never triggers any real Firebase call — every Firebase API in
 * this module is deferred to `getDb()`/`getFirebaseAuth()`, which this test never calls.
 */
describe('canUsePersistentCache', () => {
  it('is unavailable when IndexedDB does not exist in this context', () => {
    const result = canUsePersistentCache({
      hasIndexedDb: () => false,
      probeLocalStorage: () => {
        throw new Error('should never be reached once hasIndexedDb is false')
      },
    })

    expect(result).toBe(false)
  })

  it('is available when IndexedDB exists and localStorage can be written to', () => {
    const result = canUsePersistentCache({
      hasIndexedDb: () => true,
      probeLocalStorage: () => {
        /* succeeds, e.g. a real setItem/removeItem pair */
      },
    })

    expect(result).toBe(true)
  })

  it('is unavailable when localStorage throws, as in iOS Safari private mode', () => {
    const result = canUsePersistentCache({
      hasIndexedDb: () => true,
      probeLocalStorage: () => {
        throw new Error('QuotaExceededError')
      },
    })

    expect(result).toBe(false)
  })
})
