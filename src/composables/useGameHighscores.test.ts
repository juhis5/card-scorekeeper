import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'

const listeners = new Map<string, (docs: unknown[]) => void>()
const unsubscribe = vi.fn()
const ensureSignedIn = vi.fn()
const reportHandledError = vi.fn()

vi.mock('@/lib/data/firebase', () => ({
  getDb: () => 'db',
  ensureSignedIn: () => ensureSignedIn(),
}))
vi.mock('@/lib/data/stats-reads', () => ({
  watchTop: (
    _db: unknown,
    list: { field: string; direction: string },
    _count: number,
    onChange: (docs: unknown[]) => void,
  ) => {
    listeners.set(`${list.field}-${list.direction}`, onChange)
    return unsubscribe
  },
}))
vi.mock('@/lib/platform/error-reporting', () => ({
  reportHandledError: (...args: unknown[]) => reportHandledError(...args),
}))

const { useGameHighscores } = await import('./useGameHighscores')

beforeEach(() => {
  listeners.clear()
  vi.clearAllMocks()
  ensureSignedIn.mockResolvedValue('uid')
})

function start(gameId: () => string | null) {
  const scope = effectScope()
  const highscores = scope.run(() => useGameHighscores(gameId))
  if (!highscores) throw new Error('expected the composable to run')
  return { scope, highscores }
}

describe('useGameHighscores', () => {
  it("shows this game's places as its entries arrive on the three game lists", async () => {
    const { highscores } = start(() => 'ABCDE')
    await flushPromises()

    listeners.get('finalScore-asc')?.([
      { id: 'ABCDE_alice', data: { displayName: 'Alice', finalScore: 0 } },
    ])
    listeners.get('worstRound-desc')?.([
      { id: 'OTHER_x', data: { displayName: 'Ripa', worstRound: 900 } },
    ])

    expect(listeners.size).toBe(3)
    expect(highscores.value).toEqual([
      { list: 'bestGames', rank: 1, playerId: 'alice', displayName: 'Alice', value: 0 },
    ])
  })

  it('stops listening when the scope ends', async () => {
    const { scope } = start(() => 'ABCDE')
    await flushPromises()

    scope.stop()

    expect(unsubscribe).toHaveBeenCalledTimes(3)
  })

  it('never starts listening when the scope ended before sign-in finished', async () => {
    let signIn: (uid: string) => void = () => {}
    ensureSignedIn.mockReturnValue(new Promise((resolve) => (signIn = resolve)))
    const { scope } = start(() => 'ABCDE')
    await flushPromises()

    scope.stop()
    signIn('uid')
    await flushPromises()

    expect(listeners.size).toBe(0)
  })

  it('follows nothing without a game, and starts over when the game changes', async () => {
    const gameId = ref<string | null>(null)
    start(() => gameId.value)
    await flushPromises()
    expect(listeners.size).toBe(0)

    gameId.value = 'FGHJK'
    await nextTick()
    await flushPromises()

    expect(listeners.size).toBe(3)
  })

  it('reports a failure and shows nothing, as it is only an extra', async () => {
    ensureSignedIn.mockRejectedValue(new Error('offline'))
    const { highscores } = start(() => 'ABCDE')
    await flushPromises()

    expect(highscores.value).toEqual([])
    expect(reportHandledError).toHaveBeenCalledWith(expect.any(Error), 'game-highscores')
  })
})
