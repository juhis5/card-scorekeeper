import { beforeEach, describe, expect, it, vi } from 'vitest'

const checkBackendReachableMock = vi.fn()

vi.mock('@/lib/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: null }),
  getDb: () => ({}),
  checkBackendReachable: checkBackendReachableMock,
}))

vi.mock('@/lib/firestore-repository', () => ({
  // `new`-able: `game-mode.ts`'s createOnlineRepository calls `new FirestoreGameRepository(...)`,
  // so the mock must be a constructor function, not an arrow function.
  FirestoreGameRepository: vi.fn(function FirestoreGameRepository(deps: unknown) {
    return { deps }
  }),
}))

// Imported after the mocks above so both pick up the mocked modules (vi.mock is hoisted, but
// keeping the import order matching makes the wiring easy to follow).
const { useGameConnectivity } = await import('./useGameConnectivity')
const { FirestoreGameRepository } = await import('@/lib/firestore-repository')
const { LocalGameRepository } = await import('@/lib/local-repository')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useGameConnectivity().hostRepository', () => {
  it('builds an online (Firestore) repository when the backend check resolves', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    checkBackendReachableMock.mockResolvedValue('uid-1')

    const mode = await useGameConnectivity().hostRepository()

    expect(mode.kind).toBe('online')
    expect(FirestoreGameRepository).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.anything(), db: expect.anything() }),
    )
    vi.unstubAllGlobals()
  })

  it('builds a local repository when the backend check rejects', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    checkBackendReachableMock.mockRejectedValue(new Error('offline'))

    const mode = await useGameConnectivity().hostRepository()

    expect(mode).toEqual({ kind: 'offline', repository: expect.any(LocalGameRepository) })
    vi.unstubAllGlobals()
  })

  it('builds a local repository without ever checking the backend when the device is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })

    const mode = await useGameConnectivity().hostRepository()

    expect(mode.kind).toBe('offline')
    expect(checkBackendReachableMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('useGameConnectivity().joinRepository', () => {
  it('passes the given room code to the online repository when reachable', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    checkBackendReachableMock.mockResolvedValue('uid-1')

    const mode = await useGameConnectivity().joinRepository('ABCDE')

    expect(mode.kind).toBe('online')
    expect(FirestoreGameRepository).toHaveBeenCalledWith(
      expect.objectContaining({ roomCode: 'ABCDE' }),
    )
    vi.unstubAllGlobals()
  })

  it('reports unreachable, building no repository, when the device is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })

    const mode = await useGameConnectivity().joinRepository('ABCDE')

    expect(mode).toEqual({ kind: 'unreachable' })
    expect(FirestoreGameRepository).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
