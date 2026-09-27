/** The reachability check must hit the server: a cached session signs in with no network. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDocFromServerMock = vi.fn()
const signInAnonymouslyMock = vi.fn()

vi.mock('firebase/app', () => ({ initializeApp: vi.fn() }))
vi.mock('firebase/auth', () => ({
  connectAuthEmulator: vi.fn(),
  getAuth: vi.fn(),
  signInAnonymously: (...args: unknown[]) => signInAnonymouslyMock(...args),
}))
vi.mock('firebase/firestore', () => ({
  connectFirestoreEmulator: vi.fn(),
  doc: (_db: unknown, path: string) => ({ path }),
  getDocFromServer: (ref: unknown) => getDocFromServerMock(ref),
  initializeFirestore: vi.fn(),
  memoryLocalCache: vi.fn(),
  persistentLocalCache: vi.fn(),
  persistentSingleTabManager: vi.fn(),
}))

const { checkBackendReachable } = await import('./firebase')

const signedInAuth = { currentUser: { uid: 'uid-1' } } as never

beforeEach(() => {
  vi.clearAllMocks()
  getDocFromServerMock.mockResolvedValue({ exists: () => false })
})

describe('checkBackendReachable', () => {
  it('reads from the Firestore server even when a cached session is already signed in', async () => {
    await checkBackendReachable(signedInAuth, {} as never)

    expect(signInAnonymouslyMock).not.toHaveBeenCalled()
    expect(getDocFromServerMock).toHaveBeenCalledTimes(1)
  })

  it('probes a room path that can never be a real room code', async () => {
    await checkBackendReachable(signedInAuth, {} as never)

    const [ref] = getDocFromServerMock.mock.calls[0] as [{ path: string }]
    expect(ref.path).toMatch(/^room\//)
    expect(ref.path.slice('room/'.length)).not.toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/)
  })

  it('rejects when the server read fails, so the caller falls back', async () => {
    getDocFromServerMock.mockRejectedValue(
      Object.assign(new Error('offline'), { code: 'unavailable' }),
    )

    await expect(checkBackendReachable(signedInAuth, {} as never)).rejects.toThrow('offline')
  })
})
