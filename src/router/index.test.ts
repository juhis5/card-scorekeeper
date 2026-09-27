import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import router from './index'
import { useIdentityStore } from '@/stores/identity'

beforeEach(async () => {
  setActivePinia(createPinia())
  // The real router is a shared singleton: start each test from home, so its navigation is
  // never a same-location no-op.
  await router.push({ name: 'home' })
})

describe('router guard: requiresIdentity', () => {
  it('redirects to home when no device identity exists yet', async () => {
    await router.push({ name: 'room', params: { code: 'local' } })

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('allows navigation to the room once a device identity exists', async () => {
    useIdentityStore().ensureDeviceUuid(() => 'device-1')

    await router.push({ name: 'room', params: { code: 'local' } })

    expect(router.currentRoute.value.name).toBe('room')
  })

  it('redirects to home when navigating to stats with no device identity yet', async () => {
    await router.push({ name: 'stats' })

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('allows navigation to stats once a device identity exists', async () => {
    useIdentityStore().ensureDeviceUuid(() => 'device-1')

    await router.push({ name: 'stats' })

    expect(router.currentRoute.value.name).toBe('stats')
  })
})
