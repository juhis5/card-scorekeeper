/** Per-device identity: a stable deviceUuid and an editable display name, persisted. No login. */
import { defineStore } from 'pinia'
import { ref } from 'vue'
// Type-only import: makes the `persist` option below typecheck in every tsconfig project.
import type {} from 'pinia-plugin-persistedstate'

export const useIdentityStore = defineStore(
  'identity',
  () => {
    const deviceUuid = ref('')
    const displayName = ref('')

    /** Assigns a deviceUuid once. The generator is injectable so tests can pass a fixed one. */
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
