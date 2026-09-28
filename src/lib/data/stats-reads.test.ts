import { describe, expect, it, vi } from 'vitest'

const onSnapshotMock = vi.fn()
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  getDocs: vi.fn(),
  limit: (count: number) => ({ limit: count }),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
  orderBy: (field: string, direction: string) => ({ orderBy: [field, direction] }),
  query: (...parts: unknown[]) => parts,
  where: (...clause: unknown[]) => ({ where: clause }),
}))
vi.mock('./firebase', () => ({
  checkBackendReachable: vi.fn(),
  ensureSignedIn: vi.fn(),
  getDb: vi.fn(),
  getFirebaseAuth: vi.fn(),
}))

const { watchTop } = await import('./stats-reads')

describe('watchTop', () => {
  it('passes each snapshot of the sorted top list on as plain docs, and stops on request', () => {
    const stop = vi.fn()
    onSnapshotMock.mockReturnValue(stop)
    const onChange = vi.fn()

    const unsubscribe = watchTop(
      {} as never,
      { collection: 'leaderboard', field: 'finalScore', direction: 'asc' },
      10,
      onChange,
    )
    const [queryParts, onNext] = onSnapshotMock.mock.calls[0] as [unknown, (s: unknown) => void]
    onNext({ docs: [{ id: 'ABCDE_alice', data: () => ({ finalScore: 0 }) }] })
    unsubscribe()

    expect(queryParts).toEqual([
      { path: 'leaderboard' },
      { orderBy: ['finalScore', 'asc'] },
      { limit: 10 },
    ])
    expect(onChange).toHaveBeenCalledWith([{ id: 'ABCDE_alice', data: { finalScore: 0 } }])
    expect(stop).toHaveBeenCalled()
  })

  it('keeps quiet when the listener fails: the finish screen just shows nothing', () => {
    watchTop(
      {} as never,
      { collection: 'leaderboard', field: 'finalScore', direction: 'asc' },
      10,
      vi.fn(),
    )
    const onError = onSnapshotMock.mock.calls.at(-1)?.[2] as (error: Error) => void

    expect(() => onError(new Error('denied'))).not.toThrow()
  })
})
