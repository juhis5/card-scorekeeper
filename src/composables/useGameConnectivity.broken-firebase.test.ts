import { describe, expect, it, vi } from 'vitest'

/**
 * Proves the slice-5 golden-rule fix (see the "golden-rule fix" comment in useGameConnectivity.ts
 * and docs/DECISIONS.md): when `loadFirebase()` itself fails — the dynamic `import()` of
 * `lib/firebase` rejecting, or `getFirebaseAuth()`/`getDb()` throwing synchronously on a broken
 * config — "Start game" must degrade to a local single-device game, never crash outright.
 *
 * A throwing `vi.mock` factory is the simplest deterministic stand-in for either root cause: it
 * makes the dynamic `import('@/lib/data/firebase')` call inside `loadFirebase()` reject, exactly as it
 * would if the real module threw while evaluating (confirmed empirically — `getAuth(app)` on a
 * blank `VITE_FIREBASE_*` config throws `Firebase: Error (auth/invalid-api-key)` synchronously) or
 * if fetching the chunk failed outright. Isolated in its own file (rather than added to
 * useGameConnectivity.test.ts) so this throwing mock applies to every test here without disturbing
 * that file's happy-path mock (see the tdd skill's "mock at the boundary").
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
