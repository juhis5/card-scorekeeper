/**
 * Per-device identity: a stable deviceUuid (the stats key — see docs/PLAN.md "Stats &
 * history") plus an editable display name. No login. Persisted via
 * pinia-plugin-persistedstate so identity survives reloads.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
// Type-only import so the plugin's `declare module 'pinia'` augmentation (the `persist`
// store option below) is visible in every tsconfig project this file is checked under —
// not just wherever the plugin happens to be wired up at runtime (src/main.ts).
import type {} from 'pinia-plugin-persistedstate'

export const useIdentityStore = defineStore(
  'identity',
  () => {
    const deviceUuid = ref('')
    const displayName = ref('')

    /**
     * Assigns a deviceUuid the first time it's called; a no-op after that. The generator is
     * injected (defaulting to the real `crypto.randomUUID`) so tests can pass a fixed value —
     * see the `tdd` skill on never calling `crypto` directly in a path a test asserts.
     */
    function ensureDeviceUuid(generateId: () => string = () => crypto.randomUUID()): void {
      if (deviceUuid.value) return
      deviceUuid.value = generateId()
    }

    function setDisplayName(name: string): void {
      displayName.value = name
    }

    return { deviceUuid, displayName, ensureDeviceUuid, setDisplayName }
  },
  { persist: true },
)
