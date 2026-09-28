import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useIdentityStore } from './identity'

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useIdentityStore.ensureDeviceUuid', () => {
  it('generates a deviceUuid using the injected generator when none is set yet', () => {
    const identity = useIdentityStore()

    identity.ensureDeviceUuid(() => 'fixed-uuid')

    expect(identity.deviceUuid).toBe('fixed-uuid')
  })

  it('generates the uuid only once, reusing it on later calls', () => {
    const identity = useIdentityStore()
    let calls = 0
    const newId = () => {
      calls += 1
      return `uuid-${calls}`
    }

    identity.ensureDeviceUuid(newId)
    identity.ensureDeviceUuid(newId)

    expect(identity.deviceUuid).toBe('uuid-1')
    expect(calls).toBe(1)
  })

  it('generates a random UUID by default', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000000',
    )
    const identity = useIdentityStore()

    identity.ensureDeviceUuid()

    expect(identity.deviceUuid).toBe('00000000-0000-4000-8000-000000000000')
  })
})

describe('useIdentityStore.setDisplayName', () => {
  it('starts with an empty display name', () => {
    const identity = useIdentityStore()

    expect(identity.displayName).toBe('')
  })

  it('is editable', () => {
    const identity = useIdentityStore()

    identity.setDisplayName('Juho')

    expect(identity.displayName).toBe('Juho')
  })

  it('can be changed again to a different value', () => {
    const identity = useIdentityStore()

    identity.setDisplayName('Juho')
    identity.setDisplayName('Alias')

    expect(identity.displayName).toBe('Alias')
  })
})
