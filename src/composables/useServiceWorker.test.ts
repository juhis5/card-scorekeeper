import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const updateServiceWorkerMock = vi.fn().mockResolvedValue(undefined)
const needRefresh = ref(false)
const offlineReady = ref(false)

vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: () => ({
    needRefresh,
    offlineReady,
    updateServiceWorker: updateServiceWorkerMock,
  }),
}))

// Imported after the mock (vi.mock is hoisted) so it picks up the mocked virtual module — the
// real module only exists inside a Vite-built app, never in this unit test (see the tdd skill's
// "mock at the boundary").
const { useServiceWorker } = await import('./useServiceWorker')

beforeEach(() => {
  vi.clearAllMocks()
  needRefresh.value = false
  offlineReady.value = false
})

describe('useServiceWorker', () => {
  it('exposes the registration flags from the underlying SW registration', () => {
    needRefresh.value = true
    offlineReady.value = true

    const { needRefresh: exposedNeedRefresh, offlineReady: exposedOfflineReady } =
      useServiceWorker()

    expect(exposedNeedRefresh.value).toBe(true)
    expect(exposedOfflineReady.value).toBe(true)
  })

  it('calls updateServiceWorker when reload is triggered', async () => {
    const { reload } = useServiceWorker()

    await reload()

    expect(updateServiceWorkerMock).toHaveBeenCalledTimes(1)
  })

  it('clears needRefresh without updating when dismissed', () => {
    needRefresh.value = true

    const { needRefresh: exposedNeedRefresh, dismiss } = useServiceWorker()
    dismiss()

    expect(exposedNeedRefresh.value).toBe(false)
    expect(updateServiceWorkerMock).not.toHaveBeenCalled()
  })
})
