/** The part of `localStorage` local persistence uses, as our own interface so tests can inject an
 * in-memory fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function localStorageOrThrow(): KeyValueStorage {
  return (globalThis as unknown as { localStorage: KeyValueStorage }).localStorage
}

/** Blocked site data makes even reading `localStorage` throw. Reads then find nothing and writes
 * are dropped, so the app runs without persistence instead of failing to start. */
const safeLocalStorage: KeyValueStorage = {
  getItem(key) {
    try {
      return localStorageOrThrow().getItem(key)
    } catch {
      return null
    }
  },
  setItem(key, value) {
    try {
      localStorageOrThrow().setItem(key, value)
    } catch {
      // Best effort: nothing to keep it in.
    }
  },
}

/** Reached via `globalThis`, not `window`, so it resolves in any global context. */
export function browserLocalStorage(): KeyValueStorage {
  return safeLocalStorage
}
