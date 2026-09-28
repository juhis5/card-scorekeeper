import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeBackendReachable } from './connectivity'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('probeBackendReachable, offline device', () => {
  it('resolves false without calling checkBackend when isOnline reports false', async () => {
    const checkBackend = vi.fn().mockResolvedValue(undefined)

    const result = await probeBackendReachable({ isOnline: () => false, checkBackend })

    expect(result).toBe(false)
    expect(checkBackend).not.toHaveBeenCalled()
  })
})

describe('probeBackendReachable, online device', () => {
  it('resolves true when the backend check resolves before the timeout', async () => {
    const result = await probeBackendReachable({
      isOnline: () => true,
      checkBackend: () => Promise.resolve('signed-in'),
    })

    expect(result).toBe(true)
  })

  it('resolves false when the backend check rejects', async () => {
    const result = await probeBackendReachable({
      isOnline: () => true,
      checkBackend: () => Promise.reject(new Error('network down')),
    })

    expect(result).toBe(false)
  })

  it('resolves false when the backend check does not settle before the timeout', async () => {
    const checkBackend = () => new Promise<void>(() => {}) // never settles
    const resultPromise = probeBackendReachable({
      isOnline: () => true,
      checkBackend,
      timeoutMs: 3000,
    })

    await vi.advanceTimersByTimeAsync(3000)

    await expect(resultPromise).resolves.toBe(false)
  })

  it('resolves true when the backend check settles a moment before the timeout elapses', async () => {
    const checkBackend = () => new Promise<void>((resolve) => setTimeout(resolve, 100))
    const resultPromise = probeBackendReachable({
      isOnline: () => true,
      checkBackend,
      timeoutMs: 3000,
    })

    await vi.advanceTimersByTimeAsync(100)

    await expect(resultPromise).resolves.toBe(true)
  })

  it('by default waits out a cold connection of a few seconds, so a slow network still gets an online game', async () => {
    const checkBackend = () => new Promise<void>((resolve) => setTimeout(resolve, 5000))
    const resultPromise = probeBackendReachable({ isOnline: () => true, checkBackend })

    await vi.advanceTimersByTimeAsync(5000)

    await expect(resultPromise).resolves.toBe(true)
  })

  it('never throws, even when checkBackend throws synchronously instead of rejecting', async () => {
    const result = await probeBackendReachable({
      isOnline: () => true,
      checkBackend: () => {
        throw new Error('boom')
      },
    })

    expect(result).toBe(false)
  })
})

describe('probeBackendReachable, broken online check', () => {
  it('counts a device whose online check throws as unreachable, without calling checkBackend', async () => {
    const checkBackend = vi.fn().mockResolvedValue(undefined)

    const result = await probeBackendReachable({
      isOnline: () => {
        throw new Error('no navigator')
      },
      checkBackend,
    })

    expect(result).toBe(false)
    expect(checkBackend).not.toHaveBeenCalled()
  })
})

describe('probeBackendReachable defaults', () => {
  it('falls back to navigator.onLine when isOnline is not provided', async () => {
    vi.stubGlobal('navigator', { onLine: false })

    const checkBackend = vi.fn().mockResolvedValue(undefined)
    const result = await probeBackendReachable({ checkBackend })

    expect(result).toBe(false)
    expect(checkBackend).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('waits the default timeout when none is provided', async () => {
    const checkBackend = () => new Promise<void>(() => {}) // never settles
    const resultPromise = probeBackendReachable({ isOnline: () => true, checkBackend })

    await vi.advanceTimersByTimeAsync(60_000)

    await expect(resultPromise).resolves.toBe(false)
  })
})
