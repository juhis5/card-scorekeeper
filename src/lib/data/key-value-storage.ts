/** The part of `localStorage` local persistence uses, as our own interface so tests can inject an
 * in-memory fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Reached via `globalThis`, not `window`, so it resolves in any global context. */
export function browserLocalStorage(): KeyValueStorage {
  return (globalThis as unknown as { localStorage: KeyValueStorage }).localStorage
}
