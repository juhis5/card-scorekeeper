/**
 * Makes happy-dom's `navigator.sendBeacon` behave like a browser's.
 *
 * When `deleteApp` ends a Firestore WebChannel, the SDK sends a `TYPE=terminate` request through
 * `navigator.sendBeacon` and never awaits it. happy-dom implements the beacon as a plain `fetch()`
 * whose promise nobody handles. If Vitest tears the window down while that fetch is still in
 * flight, the aborted fetch rejects unhandled and the run exits 1 even though every assertion
 * passed (about 1 run in 11). A real browser never reports a beacon failure back to the page, so
 * the replacement sends the same request and drops its outcome.
 */
Object.defineProperty(navigator, 'sendBeacon', {
  configurable: true,
  value: (url: string | URL, data?: BodyInit | null): boolean => {
    void fetch(url, { method: 'POST', body: data ?? null }).catch(() => undefined)
    return true
  },
})
