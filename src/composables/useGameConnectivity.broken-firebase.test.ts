import { describe, expect, it, vi } from 'vitest'

/**
 * When Firebase fails to load (a missing chunk, or a broken config throwing), the host still gets
 * a local game. A throwing mock stands in for both. Its own file, so the happy-path mocks in
 * useGameConnectivity.test.ts stay intact.
 */
vi.mock('@/lib/data/firebase', () => {
  throw new Error('Firebase: Error (auth/invalid-api-key).')
})
vi.mock('@/lib/data/firestore-repository', () => ({
  FirestoreGameRepository: vi.fn(function FirestoreGameRepository() {
    return {}
  }),
}))

const { useGameConnectivity } = await import('./useGameConnectivity')
const { LocalGameRepository } = await import('@/lib/data/local-repository')

describe('useGameConnectivity, broken Firebase setup (CLAUDE.md "offline-capable host" golden rule)', () => {
  it('falls back to a local single-device game on the host path instead of failing "Start game"', async () => {
    vi.stubGlobal('navigator', { onLine: true })

    const mode = await useGameConnectivity().hostRepository()

    expect(mode).toEqual({ kind: 'offline', repository: expect.any(LocalGameRepository) })
    vi.unstubAllGlobals()
  })

  it('reports unreachable on the join path — join has no local fallback to degrade to', async () => {
    vi.stubGlobal('navigator', { onLine: true })

    const mode = await useGameConnectivity().joinRepository('ABCDE')

    expect(mode).toEqual({ kind: 'unreachable' })
    vi.unstubAllGlobals()
  })
})
