import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetRoom, lastRoom, rememberRoom } from './last-room'
import { ROOM_TTL_MS } from '../game/room-code'
import type { KeyValueStorage } from './key-value-storage'

function makeMemoryStorage(): KeyValueStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  }
}

const HOUR_MS = 60 * 60 * 1000

describe('last online room', () => {
  it('remembers the room this device is in', () => {
    const storage = makeMemoryStorage()
    rememberRoom('7K4RQ', { storage, now: () => 0 })

    expect(lastRoom({ storage, now: () => 5 * HOUR_MS })).toBe('7K4RQ')
  })

  it('forgets a room once it would have expired', () => {
    const storage = makeMemoryStorage()
    rememberRoom('7K4RQ', { storage, now: () => 0 })

    expect(lastRoom({ storage, now: () => ROOM_TTL_MS })).toBeNull()
  })

  it('forgets the room when told, but only that room', () => {
    const storage = makeMemoryStorage()
    rememberRoom('7K4RQ', { storage, now: () => 0 })

    forgetRoom('ABCDE', { storage })
    expect(lastRoom({ storage, now: () => 0 })).toBe('7K4RQ')

    forgetRoom('7K4RQ', { storage })
    expect(lastRoom({ storage, now: () => 0 })).toBeNull()
  })

  it('treats a missing or corrupted value as no room', () => {
    const storage = makeMemoryStorage()
    expect(lastRoom({ storage, now: () => 0 })).toBeNull()

    storage.setItem('card-scorekeeper:last-room', '{not json')
    expect(lastRoom({ storage, now: () => 0 })).toBeNull()
  })

  it.each(['null', '"7K4RQ"', '{"code":"7K4RQ"}', '{"code":7,"savedAtMs":0}'])(
    'treats a stored value of the wrong shape (%s) as no room',
    (stored) => {
      const storage = makeMemoryStorage()
      storage.setItem('card-scorekeeper:last-room', stored)

      expect(lastRoom({ storage, now: () => 0 })).toBeNull()
    },
  )

  it('never throws when storage is unavailable, as in some private windows', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }

    expect(() => rememberRoom('7K4RQ', { storage: broken })).not.toThrow()
    expect(lastRoom({ storage: broken })).toBeNull()
    expect(() => forgetRoom('7K4RQ', { storage: broken })).not.toThrow()
  })
})

describe('last online room without injected deps', () => {
  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it("keeps the room in the browser's localStorage, timed by the real clock", () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    rememberRoom('7K4RQ')

    vi.setSystemTime(ROOM_TTL_MS - 1)
    expect(lastRoom()).toBe('7K4RQ')

    vi.setSystemTime(ROOM_TTL_MS)
    expect(lastRoom()).toBeNull()
  })

  it("forgets the room from the browser's localStorage", () => {
    rememberRoom('7K4RQ')
    expect(lastRoom()).toBe('7K4RQ')

    forgetRoom('7K4RQ')

    expect(lastRoom()).toBeNull()
  })
})
