// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  checkRateLimit,
  decideRateLimit,
  InMemoryRateLimitStore,
  type RateLimitConfig,
} from './rate-limit'

const config: RateLimitConfig = { windowMs: 1000, maxRequests: 2 }

describe('decideRateLimit', () => {
  it('allows the first request in a fresh window', () => {
    const decision = decideRateLimit(undefined, 0, config)
    expect(decision).toEqual({ allowed: true, nextState: { count: 1, windowStartMs: 0 } })
  })

  it('allows requests up to the max within the same window', () => {
    const first = decideRateLimit(undefined, 0, config)
    const second = decideRateLimit(first.nextState, 100, config)
    expect(second).toEqual({ allowed: true, nextState: { count: 2, windowStartMs: 0 } })
  })

  it('rejects a request once the window is at its max, without incrementing further', () => {
    const previous = { count: 2, windowStartMs: 0 }
    const decision = decideRateLimit(previous, 500, config)
    expect(decision).toEqual({ allowed: false, nextState: { count: 2, windowStartMs: 0 } })
  })

  it('resets the window once windowMs has elapsed', () => {
    const previous = { count: 2, windowStartMs: 0 }
    const decision = decideRateLimit(previous, 1000, config)
    expect(decision).toEqual({ allowed: true, nextState: { count: 1, windowStartMs: 1000 } })
  })
})

describe('checkRateLimit with InMemoryRateLimitStore', () => {
  it('allows calls up to the cap and rejects the one after', async () => {
    const store = new InMemoryRateLimitStore()
    const key = 'room:ABCD'

    expect(await checkRateLimit(store, key, config, 0)).toBe(true)
    expect(await checkRateLimit(store, key, config, 10)).toBe(true)
    expect(await checkRateLimit(store, key, config, 20)).toBe(false)
  })

  it('tracks separate keys independently', async () => {
    const store = new InMemoryRateLimitStore()

    expect(await checkRateLimit(store, 'room:AAAA', config, 0)).toBe(true)
    expect(await checkRateLimit(store, 'room:AAAA', config, 10)).toBe(true)
    expect(await checkRateLimit(store, 'room:BBBB', config, 20)).toBe(true)
  })

  it('allows calls again once the window rolls over', async () => {
    const store = new InMemoryRateLimitStore()
    const key = 'global'

    expect(await checkRateLimit(store, key, config, 0)).toBe(true)
    expect(await checkRateLimit(store, key, config, 10)).toBe(true)
    expect(await checkRateLimit(store, key, config, 20)).toBe(false)
    expect(await checkRateLimit(store, key, config, 1000)).toBe(true)
  })
})
