/**
 * Per-room and global rate limits: a pure fixed-window decision and an injectable store. The
 * in-memory store caps per instance, which the owner accepted (docs/DECISIONS.md); a shared store
 * such as Upstash/Redis can implement the same interface.
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

/** Whether one more request is allowed now, and the state to persist either way (a rejected
 * request uses no slot). */
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

/** Rate-limit windows by key: a room, or the global key. */
export interface RateLimitStore {
  get(key: string): Promise<RateLimitWindowState | undefined>
  set(key: string, state: RateLimitWindowState): Promise<void>
}

/** Exact within one process. Each Vercel instance and cold start gets its own Map, so the caps are
 * per instance; Gemini's free-tier quota is the real ceiling. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, RateLimitWindowState>()

  async get(key: string): Promise<RateLimitWindowState | undefined> {
    return this.windows.get(key)
  }

  async set(key: string, state: RateLimitWindowState): Promise<void> {
    this.windows.set(key, state)
  }
}

/** Checks and records one request against `key`. Returns whether it's allowed. */
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
