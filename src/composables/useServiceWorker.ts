/**
 * Wraps vite-plugin-pwa's `useRegisterSW` (see vite.config.ts's `registerType: 'prompt'`) with
 * the one bit of behavior this app needs: a dismissible "update available" prompt instead of an
 * `autoUpdate` reload that could cut a round short mid-game — see the `pwa` + `error-ux` skills.
 * Kept as its own composable (not inlined in App.vue) so the update-prompt logic is unit-testable
 * without mounting a component tree.
 */
import { useRegisterSW } from 'virtual:pwa-register/vue'

export function useServiceWorker() {
  const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW()

  /** Activates the waiting service worker and reloads — only ever user-triggered, never automatic. */
  function reload(): Promise<void> {
    return updateServiceWorker()
  }

  /** Dismisses the prompt without updating; the waiting worker activates on the next natural reload. */
  function dismiss(): void {
    needRefresh.value = false
  }

  return { needRefresh, offlineReady, reload, dismiss }
}
