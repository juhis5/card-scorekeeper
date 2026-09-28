import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const updateServiceWorker = vi.fn().mockResolvedValue(undefined)
const needRefresh = ref(false)
let registerOptions: { onRegisteredSW?: (url: string, registration: unknown) => void } = {}

vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: (options: typeof registerOptions) => {
    registerOptions = options
    return { needRefresh, offlineReady: ref(false), updateServiceWorker }
  },
}))

const checkForUpdatesRegularly = vi.fn()
vi.mock('@/lib/platform/update-checks', () => ({
  checkForUpdatesRegularly: (...args: unknown[]) => checkForUpdatesRegularly(...args),
}))

// Imported after the mocks: the virtual module only exists inside a Vite-built app.
const { useAppUpdateStore } = await import('./app-update')

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  needRefresh.value = false
})

describe('useAppUpdateStore', () => {
  it('says when a new version is waiting, and reloads into it only when asked', async () => {
    const update = useAppUpdateStore()
    needRefresh.value = true

    expect(update.needRefresh).toBe(true)
    expect(updateServiceWorker).not.toHaveBeenCalled()
    await update.reload()
    expect(updateServiceWorker).toHaveBeenCalledTimes(1)
  })

  it('hides the prompt without updating when dismissed', () => {
    const update = useAppUpdateStore()
    needRefresh.value = true

    update.dismiss()

    expect(update.needRefresh).toBe(false)
    expect(updateServiceWorker).not.toHaveBeenCalled()
  })

  it('keeps looking for new versions once the service worker is registered', () => {
    useAppUpdateStore()
    const registration = { update: vi.fn() }

    registerOptions.onRegisteredSW?.('/sw.js', registration)

    expect(checkForUpdatesRegularly).toHaveBeenCalledWith(registration)
  })

  it('schedules no update checks when the service worker registers without a registration', () => {
    useAppUpdateStore()

    registerOptions.onRegisteredSW?.('/sw.js', undefined)

    expect(checkForUpdatesRegularly).not.toHaveBeenCalled()
  })
})
