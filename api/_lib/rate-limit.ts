/**
 * Layers 2/3 of the vercel-gemini skill's gate: per-room and global rate limits. The decision
 * (`decideRateLimit`) is a pure fixed-window function, unit-tested directly with injected clock
 * values — no store, no mocking. `RateLimitStore` is the injectable persistence seam:
 * `InMemoryRateLimitStore` below is for tests and local `vercel dev` only. Production should wire
 * a Vercel KV / Upstash-backed implementation of the same interface (see the vercel-gemini skill
 * — "Use Vercel KV / Upstash (in-memory won't span instances or cold starts)"); not built in this
 * slice (see the handoff notes) so this function ships without a live KV dependency.
 */

export interface RateLimitWindowState {
  count: number
  windowStartMs: number
}

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
}

export interface RateLimitDecision {
  allowed: boolean
  nextState: RateLimitWindowState
}

/**
 * Pure fixed-window rate-limit decision: given the previous window (if any) for a key, decides
 * whether one more request is allowed right now, and returns the state to persist either way (a
 * rejected request does not consume a slot).
 */
export function decideRateLimit(
  previous: RateLimitWindowState | undefined,
  nowMs: number,
  config: RateLimitConfig,
): RateLimitDecision {
  const windowExpired = !previous || nowMs - previous.windowStartMs >= config.windowMs
  const current: RateLimitWindowState = windowExpired
    ? { count: 0, windowStartMs: nowMs }
    : previous

  const allowed = current.count < config.maxRequests
  const nextCount = allowed ? current.count + 1 : current.count
  return { allowed, nextState: { count: nextCount, windowStartMs: current.windowStartMs } }
}

/** Injectable persistence for rate-limit windows, keyed by an arbitrary string (a room code, or a
 * fixed key for the global cap). */
export interface RateLimitStore {
  get(key: string): Promise<RateLimitWindowState | undefined>
  set(key: string, state: RateLimitWindowState): Promise<void>
}

/**
 * In-memory `RateLimitStore` — correct within a single process, which is enough for unit tests
 * and `vercel dev`. NOT a real cap in production: Vercel runs multiple horizontally-scaled
 * instances and cold-starts fresh ones, none of which share this Map (see the module doc comment
 * and the handoff notes — this is a known, flagged limitation, not an oversight).
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, RateLimitWindowState>()

  async get(key: string): Promise<RateLimitWindowState | undefined> {
    return this.windows.get(key)
  }

  async set(key: string, state: RateLimitWindowState): Promise<void> {
    this.windows.set(key, state)
  }
}

/** Checks and records one request against `key`'s rate limit, using the injected store. Returns
 * whether the request is allowed. */
export async function checkRateLimit(
  store: RateLimitStore,
  key: string,
  config: RateLimitConfig,
  nowMs: number,
): Promise<boolean> {
  const previous = await store.get(key)
  const { allowed, nextState } = decideRateLimit(previous, nowMs, config)
  await store.set(key, nextState)
  return allowed
}
