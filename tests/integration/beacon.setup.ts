/**
 * Makes happy-dom's `navigator.sendBeacon` behave like a browser's. `deleteApp` ends a Firestore
 * WebChannel with a `TYPE=terminate` beacon it never awaits. happy-dom sends it as a plain
 * `fetch()`, and if Vitest tears the window down mid-flight, the aborted fetch rejects unhandled
 * and fails the run (about 1 in 11) although every test passed. A browser never reports a beacon's
 * outcome to the page, so this sends the same request and drops the result.
 */
Object.defineProperty(navigator, 'sendBeacon', {
  configurable: true,
  value: (url: string | URL, data?: BodyInit | null): boolean => {
    void fetch(url, { method: 'POST', body: data ?? null }).catch(() => undefined)
    return true
  },
})
