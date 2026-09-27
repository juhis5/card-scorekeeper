/**
 * A waiting new version (vite.config.ts: `registerType: 'prompt'`). Never an automatic reload
 * mid-game: a banner and the menu offer it, and the player chooses. Checked regularly, not only
 * on launch.
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
