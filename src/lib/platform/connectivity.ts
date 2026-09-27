/** Whether the backend answers, e.g. before starting or joining a game. Never throws: a probe that
 * can't tell counts as unreachable. */

/** A cold Firestore connection alone can take close to 3 s (seen in CI), and giving up too soon puts
 * a host in a local game nobody can join. A device known to be offline still skips the wait. */
const DEFAULT_TIMEOUT_MS = 8000

export interface ProbeBackendReachableDeps {
  /** Defaults to `navigator.onLine`. Checked first, so a device known to be offline skips the
   * round trip. */
  isOnline?: () => boolean
  /** A lightweight backend call; resolving means reachable. */
  checkBackend: () => Promise<unknown>
  timeoutMs?: number
}

function timeout(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
}

/** True only if `checkBackend` succeeds before the timeout. Every failure, even a synchronous
 * throw, counts as offline. */
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
