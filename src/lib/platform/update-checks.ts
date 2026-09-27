/**
 * How soon a new version shows up (fourth round: "make it faster to prompt the update"). The
 * browser only looks for a new service worker on a navigation, and an installed app left open at
 * the table may not navigate for hours. So: every half hour, and whenever the app comes back to
 * the screen. Only while visible and online.
 */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

export interface UpdateCheckOptions {
  /** The document, or a stand-in in tests. */
  page?: EventTarget & { visibilityState: string }
  isOnline?: () => boolean
}

/** Returns a function that stops the checks. */
export function checkForUpdatesRegularly(
  registration: Pick<ServiceWorkerRegistration, 'update'>,
  { page = document, isOnline = () => navigator.onLine }: UpdateCheckOptions = {},
): () => void {
  function check(): void {
    if (page.visibilityState !== 'visible' || !isOnline()) return
    // A check that fails (connection dropped, server busy) is simply tried again on the next one.
    registration.update().catch(() => undefined)
  }
  const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS)
  page.addEventListener('visibilitychange', check)
  return () => {
    clearInterval(timer)
    page.removeEventListener('visibilitychange', check)
  }
}
