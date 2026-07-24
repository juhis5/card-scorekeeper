import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { render, screen, fireEvent } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import GameSetup from './GameSetup.vue'
import { useGameStore } from '@/stores/game'
import { LocalGameRepository } from '@/lib/local-repository'
import type { KeyValueStorage } from '@/lib/local-repository'
import { i18n } from '@/i18n'
import type { GameRepository } from '@/lib/repository'
import type { GameState } from '@/lib/types'
import type { HostGameMode } from '@/lib/game-mode'

// The store's own test suite (stores/game.test.ts) covers isHost/myPlayerId/isOnline directly;
// here we only need to prove GameSetup drives the right repository/route for each outcome, so
// the connectivity-checked repository choice — the one thing this component owns — is mocked at
// its own seam (see the tdd skill's "mock at the boundary") rather than the lower-level
// connectivity/Firebase modules it's built from.
const { hostRepository } = vi.hoisted(() => ({ hostRepository: vi.fn() }))

vi.mock('@/composables/useGameConnectivity', () => ({
  useGameConnectivity: () => ({ hostRepository, joinRepository: vi.fn() }),
}))

/** A plain in-memory stand-in for localStorage — deterministic, no real browser API. */
function makeMemoryStorage(): KeyValueStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

function offlineMode(): HostGameMode {
  return { kind: 'offline', repository: new LocalGameRepository({ storage: makeMemoryStorage() }) }
}

/** A hand-written online repository so tests never touch real Firestore — see the tdd skill. */
function makeFakeOnlineRepository(roomCode: string): GameRepository {
  return {
    createGame: vi.fn().mockResolvedValue({ gameId: roomCode, roomCode, hostPlayerId: 'host-uid' }),
    addPlayer: vi.fn(),
    subscribe: vi.fn((onChange: (state: GameState) => void) => {
      onChange({
        status: 'waiting',
        currentRound: 1,
        players: [{ id: 'host-uid', name: 'Juho', totalScore: 0 }],
        roundScores: [],
      })
      return () => {}
    }),
    setRoundScore: vi.fn(),
    advanceRound: vi.fn(),
    finishGame: vi.fn(),
    leave: vi.fn(),
  }
}

function makeTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/room/:code', name: 'room', component: { template: '<div />' } },
    ],
  })
}

function renderGameSetup() {
  const router = makeTestRouter()
  render(GameSetup, { global: { plugins: [i18n, router] } })
  return router
}

/** A promise you can resolve from outside — lets a test observe the "checking connection…"
 * state while the probe is still in flight, without a real network delay. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  setActivePinia(createPinia())
  hostRepository.mockReset()
})

describe('GameSetup validation', () => {
  it('shows a host-name error and never probes connectivity when the host name is missing', async () => {
    renderGameSetup()

    await fireEvent.click(screen.getByRole('button', { name: 'Start game' }))
    await flushPromises()

    expect(screen.getByText('Enter your name to continue.')).toBeTruthy()
    expect(hostRepository).not.toHaveBeenCalled()
  })

  it('requires at least one other player only once hosting resolves to a local (offline) game', async () => {
    hostRepository.mockResolvedValue(offlineMode())
    const router = renderGameSetup()

    await fireEvent.update(screen.getByLabelText('Your name'), 'Juho')
    await fireEvent.click(screen.getByRole('button', { name: 'Start game' }))
    await flushPromises()

    expect(screen.getByText('Add at least one other player.')).toBeTruthy()
    expect(screen.queryByText('Enter your name to continue.')).toBeNull()
    expect(router.currentRoute.value.name).toBe('home')
  })
})

describe('GameSetup adding and removing players', () => {
  it('adds and removes other-player name fields', async () => {
    renderGameSetup()

    expect(screen.getAllByLabelText(/Player \d name/)).toHaveLength(1)

    await fireEvent.click(screen.getByRole('button', { name: 'Add player' }))
    expect(screen.getAllByLabelText(/Player \d name/)).toHaveLength(2)

    await fireEvent.click(screen.getByRole('button', { name: 'Remove player 1' }))
    expect(screen.getAllByLabelText(/Player \d name/)).toHaveLength(1)
  })
})

describe('GameSetup hosting offline (backend unreachable)', () => {
  it('starts a local game with the entered players and navigates to the room', async () => {
    hostRepository.mockResolvedValue(offlineMode())
    const router = renderGameSetup()
    const game = useGameStore()

    await fireEvent.update(screen.getByLabelText('Your name'), 'Juho')
    await fireEvent.update(screen.getByLabelText('Player 1 name'), 'Alice')
    await fireEvent.click(screen.getByRole('button', { name: 'Start game' }))
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('room')
    expect(router.currentRoute.value.params.code).toBe('local')
    expect(game.standings.map((standing) => standing.player.name).sort()).toEqual(['Alice', 'Juho'])
  })
})

describe('GameSetup hosting online (backend reachable)', () => {
  it('hosts with just the host name and navigates to the real room code, ignoring any typed other players', async () => {
    const onlineRepo = makeFakeOnlineRepository('7K4RQ')
    hostRepository.mockResolvedValue({ kind: 'online', repository: onlineRepo })
    const router = renderGameSetup()
    const game = useGameStore()

    await fireEvent.update(screen.getByLabelText('Your name'), 'Juho')
    await fireEvent.update(screen.getByLabelText('Player 1 name'), 'Alice')
    await fireEvent.click(screen.getByRole('button', { name: 'Start game' }))
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('room')
    expect(router.currentRoute.value.params.code).toBe('7K4RQ')
    expect(onlineRepo.addPlayer).not.toHaveBeenCalled()
    expect(game.isHost).toBe(true)
    expect(game.isOnline).toBe(true)
    expect(screen.queryByText('Add at least one other player.')).toBeNull()
  })
})

describe('GameSetup connection status', () => {
  it('shows a checking-connection status while the probe/creation is pending, then clears it', async () => {
    const { promise, resolve } = deferred<HostGameMode>()
    hostRepository.mockReturnValue(promise)
    renderGameSetup()

    await fireEvent.update(screen.getByLabelText('Your name'), 'Juho')
    await fireEvent.click(screen.getByRole('button', { name: 'Start game' }))
    await flushPromises()

    expect(screen.getByText('Checking connection…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    resolve(offlineMode())
    await flushPromises()

    expect(screen.queryByText('Checking connection…')).toBeNull()
  })
})

describe('GameSetup start failure', () => {
  it('shows a friendly error, never a raw one, when the repository probe rejects', async () => {
    hostRepository.mockRejectedValue(new Error('boom'))
    renderGameSetup()

    await fireEvent.update(screen.getByLabelText('Your name'), 'Juho')
    await fireEvent.click(screen.getByRole('button', { name: 'Start game' }))
    await flushPromises()

    expect(screen.getByText("Couldn't start the game. Try again.")).toBeTruthy()
  })
})
