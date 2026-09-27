import { describe, expect, it } from 'vitest'
import { canUsePersistentCache } from './firebase'

// No mocks needed: importing './firebase' makes no Firebase call until getDb()/getFirebaseAuth().
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
        /* succeeds */
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
