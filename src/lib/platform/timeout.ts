/** Shaped like Firestore's `deadline-exceeded` error, so write-errors.ts treats it as transient. */
export class TimeoutError extends Error {
  readonly code = 'deadline-exceeded'

  constructor(ms: number) {
    super(`timed out after ${ms} ms`)
    this.name = 'TimeoutError'
  }
}

/** Firestore writes don't fail while offline, they wait forever, so anything the UI waits on
 * needs a bound. The operation itself isn't cancelled. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
