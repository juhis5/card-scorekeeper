import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import router from './index'
import { useIdentityStore } from '@/stores/identity'

beforeEach(async () => {
  setActivePinia(createPinia())
  // `router` is the app's real singleton (shared across every test in this file, and every
  // shuffled run order) — reset it to a neutral route first so each test starts a genuine
  // navigation rather than a same-location no-op if the previous test left it on `room`.
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
})
