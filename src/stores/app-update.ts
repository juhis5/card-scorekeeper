/**
 * A new version of the app, waiting (see vite.config.ts's `registerType: 'prompt'`). A card table
 * shouldn't lose a round to an automatic reload mid-game, so the app only says so, in a banner
 * and in the menu, and reloading is the player's own choice. It looks for one regularly, not only
 * on a cold start (lib/platform/update-checks.ts).
 */
import { defineStore } from 'pinia'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { checkForUpdatesRegularly } from '@/lib/platform/update-checks'

export const useAppUpdateStore = defineStore('app-update', () => {
  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) checkForUpdatesRegularly(registration)
    },
  })

  /** Activates the waiting version and reloads. */
  function reload(): Promise<void> {
    return updateServiceWorker()
  }

  /** Hides the banner; the new version starts on the next natural reload. */
  function dismiss(): void {
    needRefresh.value = false
  }

  return { needRefresh, reload, dismiss }
})
