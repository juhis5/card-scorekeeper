/**
 * The minimal `localStorage` shape this app's local persistence needs (game state in
 * `local-repository.ts`, the pending-results queue in `pending-results.ts`). Kept as our own
 * interface — decoupled from lib.dom's `Storage` — so tests can inject a plain in-memory fake
 * instead of driving a real browser API (see the tdd skill's "mock I/O at the boundary").
 *
 * Extracted here (rather than duplicated) once a second module needed it — see the clean-code
 * skill's "extract on the second real duplication".
 */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The real browser localStorage, typed as our own `KeyValueStorage` rather than lib.dom's
 * `Storage` and reached via `globalThis` (not the `window` identifier) so it resolves in any
 * global context this might run in. */
export function browserLocalStorage(): KeyValueStorage {
  return (globalThis as unknown as { localStorage: KeyValueStorage }).localStorage
}
