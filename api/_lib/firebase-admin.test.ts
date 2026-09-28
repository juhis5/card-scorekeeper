import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('firebase-admin/app', () => ({
  cert: vi.fn(),
  getApps: () => [],
  initializeApp: vi.fn(),
}))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: vi.fn() }))
vi.mock('jose', () => ({ createRemoteJWKSet: vi.fn() }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('the service-account secret', () => {
  it('never shows up in the error when it is not valid JSON, since errors are logged', async () => {
    // The quotes around private_key lost when pasting: V8 would quote the key's first characters.
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT', '{"project_id":"p","private_key":MIIEvQIBADANBgkq}')
    const { verifyIdToken } = await import('./firebase-admin')

    const error = await verifyIdToken('token').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('FIREBASE_SERVICE_ACCOUNT is not valid JSON')
    expect((error as Error).message).not.toContain('MIIE')
    expect((error as Error).cause).toBeUndefined()
  })
})
