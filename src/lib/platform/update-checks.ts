/** The browser only looks for a new service worker on navigation, and an installed app can stay
 * open for hours without one. So check every half hour and on return to the screen. */
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
    // A failed check just waits for the next one.
    registration.update().catch(() => undefined)
  }
  const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS)
  page.addEventListener('visibilitychange', check)
  return () => {
    clearInterval(timer)
    page.removeEventListener('visibilitychange', check)
  }
}
