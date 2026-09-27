/**
 * Layers 2/3 of the vercel-gemini skill's gate: per-room and global rate limits. The decision
 * (`decideRateLimit`) is a pure fixed-window function, unit-tested directly with injected clock
 * values — no store, no mocking. `RateLimitStore` is the injectable persistence seam: production
 * uses `InMemoryRateLimitStore` below, a per-instance cap the owner accepted (docs/DECISIONS.md,
 * review round 5). A shared Upstash/Redis store can implement the same interface if that changes.
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
 * In-memory `RateLimitStore` — exact within one process. In production each Vercel instance, and
 * each cold start, gets its own Map, so the caps are per instance; Gemini's free-tier quota is the
 * real ceiling (see the module doc comment).
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
