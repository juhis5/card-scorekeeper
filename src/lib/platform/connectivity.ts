/**
 * Backend-reachability probe used on "start game" to pick between the online and offline
 * `GameRepository` (see `game-mode.ts` and docs/PLAN.md "Offline host mode"). Never throws — a
 * probe that can't tell is treated as unreachable, not a crash. Every input is injected
 * (`isOnline`, `checkBackend`, `timeoutMs`) so tests are deterministic: no real network, no real
 * clock (see the tdd skill).
 */

/** How long to wait for `checkBackend` before treating the backend as unreachable. */
/** A cold Firestore connection alone can take close to 3 s (seen in CI), and giving up too soon puts
 * a host in a local game nobody can join. A device known to be offline still skips the wait. */
const DEFAULT_TIMEOUT_MS = 8000

export interface ProbeBackendReachableDeps {
  /** Defaults to `navigator.onLine`. Checked first — a device the OS already reports as offline
   * skips the network round-trip entirely. */
  isOnline?: () => boolean
  /** A lightweight backend call, e.g. `() => ensureSignedIn(auth)` — resolving means reachable. */
  checkBackend: () => Promise<unknown>
  /** Milliseconds to wait for `checkBackend` before giving up. Defaults to `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number
}

/** Resolves `false` after `timeoutMs`, standing in for "checkBackend took too long". */
function timeout(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
}

/**
 * Races `checkBackend` against a timeout. Resolves `true` only if `checkBackend` settles first
 * *and* succeeds; resolves `false` for an offline device, a rejection, a timeout, or a
 * `checkBackend` that throws synchronously — every failure mode collapses to the same "treat as
 * offline" answer.
 */
export async function probeBackendReachable(deps: ProbeBackendReachableDeps): Promise<boolean> {
  try {
    const isOnline = deps.isOnline ?? (() => navigator.onLine)
    if (!isOnline()) return false

    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const succeeded = Promise.resolve()
      .then(() => deps.checkBackend())
      .then(() => true)
      .catch(() => false)

    return await Promise.race([succeeded, timeout(timeoutMs)])
  } catch {
    return false
  }
}
