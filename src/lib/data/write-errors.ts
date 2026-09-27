/**
 * Classifies a rejected Firestore write by its error `code`, without importing the Firebase SDK
 * (so offline code paths never load it). Unknown shapes count as transient: better to retry a
 * write that can never succeed than to give up on one that could.
 */

/** Codes where retrying the identical write can never succeed: the rules or the data say no. */
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

/** True for the `permission-denied` error a write rejected by `firestore.rules` surfaces as. */
export function isPermissionDenied(error: unknown): boolean {
  return errorCode(error) === 'permission-denied'
}

export function isPermanentWriteError(error: unknown): boolean {
  const code = errorCode(error)
  return code !== undefined && PERMANENT_WRITE_ERROR_CODES.has(code)
}
