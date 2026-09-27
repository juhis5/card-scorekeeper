/** A timeout shaped like Firestore's own `deadline-exceeded` error, so write-error classification
 * (lib/write-errors.ts) treats it as transient. */
export class TimeoutError extends Error {
  readonly code = 'deadline-exceeded'

  constructor(ms: number) {
    super(`timed out after ${ms} ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * Rejects if `promise` hasn't settled within `ms`. Firestore writes don't fail while offline, they
 * wait for the server indefinitely, so anything the UI waits on needs a bound. The underlying
 * operation isn't cancelled; this only stops the caller from waiting on it.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
