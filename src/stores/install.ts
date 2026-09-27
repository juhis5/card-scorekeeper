/**
 * Installing from the menu. Chromium fires `beforeinstallprompt` once, early, so main.ts catches
 * it at startup and it waits here until "Install the app" is tapped. Elsewhere the menu shows
 * this device's install steps, or nothing.
 */
import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { installGuideFor, type DeviceHints, type InstallGuide } from '@/lib/platform/install-guide'

/** Chromium only, so not in the DOM types. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
}

/** What `listen` needs of `window`, so tests can hand it their own. */
export interface InstallTarget extends EventTarget {
  matchMedia(query: string): { matches: boolean }
  navigator: DeviceHints & { standalone?: boolean }
}

/** iOS home-screen apps report `navigator.standalone`; everything else the display mode. */
function runsInstalled(target: InstallTarget): boolean {
  return (
    target.matchMedia('(display-mode: standalone)').matches || target.navigator.standalone === true
  )
}

export const useInstallStore = defineStore('install', () => {
  const installPrompt = shallowRef<BeforeInstallPromptEvent | null>(null)
  const isInstalled = ref(false)
  const guide = ref<InstallGuide | null>(null)

  const canPrompt = computed(() => installPrompt.value !== null)
  const isAvailable = computed(
    () => !isInstalled.value && (canPrompt.value || guide.value !== null),
  )

  function listen(target: InstallTarget): void {
    isInstalled.value = runsInstalled(target)
    guide.value = installGuideFor(target.navigator)
    target.addEventListener('beforeinstallprompt', (event) => {
      // Not the browser's own banner mid-game: the menu offers it when the player asks.
      event.preventDefault()
      installPrompt.value = event as BeforeInstallPromptEvent
    })
    target.addEventListener('appinstalled', () => {
      installPrompt.value = null
      isInstalled.value = true
    })
  }

  /** A prompt can be shown only once; the browser fires a new one if it's still installable. */
  async function promptInstall(): Promise<void> {
    const prompt = installPrompt.value
    if (!prompt) return
    installPrompt.value = null
    await prompt.prompt()
  }

  return { guide, canPrompt, isAvailable, listen, promptInstall }
})
