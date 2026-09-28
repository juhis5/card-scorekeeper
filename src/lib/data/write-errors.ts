/** Reads the error `code` without importing the Firebase SDK, so offline paths never load it.
 * Unknown shapes count as transient: better to retry a hopeless write than drop a good one. */

/** Retrying the same write can never succeed: the rules or the data say no. */
const PERMANENT_WRITE_ERROR_CODES: ReadonlySet<string> = new Set([
  'permission-denied',
  'invalid-argument',
  'failed-precondition',
  'out-of-range',
])

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const { code } = error as { code: unknown }
  return typeof code === 'string' ? code : undefined
}

/** Firestore couldn't reach the server (offline, or a read that gave up). Worth retrying later. */
export function isUnavailable(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'unavailable' || code === 'deadline-exceeded'
}

export function isPermissionDenied(error: unknown): boolean {
  return errorCode(error) === 'permission-denied'
}

export function isPermanentWriteError(error: unknown): boolean {
  const code = errorCode(error)
  return code !== undefined && PERMANENT_WRITE_ERROR_CODES.has(code)
}
