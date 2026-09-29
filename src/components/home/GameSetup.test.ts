import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { render, screen, fireEvent } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import GameSetup from './GameSetup.vue'
import { useGameStore } from '@/stores/game'
import { LocalGameRepository } from '@/lib/data/local-repository'
import type { KeyValueStorage } from '@/lib/data/local-repository'
import { NameClaimedError } from '@/lib/game/player-names'
import { i18n } from '@/i18n'
import type { GameRepository } from '@/lib/data/repository'
import type { GameState } from '@/lib/game/types'
import type { HostGameMode } from '@/lib/data/game-mode'

// Mock the repository choice, the one thing GameSetup owns, not the connectivity/Firebase modules
// under it. The store's own tests cover isHost/myPlayerId/isOnline.
const { hostRepository, localRepository } = vi.hoisted(() => ({
  hostRepository: vi.fn(),
  localRepository: vi.fn(),
}))

vi.mock('@/composables/useGameConnectivity', () => ({
  useGameConnectivity: () => ({ hostRepository, joinRepository: vi.fn(), localRepository }),
}))

/** An in-memory stand-in for localStorage. */
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

/** A hand-written online repository, so tests never touch Firestore. */
function makeFakeOnlineRepository(roomCode: string): GameRepository {
  return {
    createGame: vi.fn().mockResolvedValue({ gameId: roomCode, roomCode, hostPlayerId: 'host-uid' }),
    addPlayer: vi.fn(),
    addGuest: vi.fn().mockResolvedValue('guest-id'),
    removePlayer: vi.fn(),
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
    abandonGame: vi.fn(),
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

/** GameSetup with its name bound the way Home binds it (`v-model:name`). */
const BoundGameSetup = defineComponent({
  setup() {
    const name = ref('')
    return () =>
      h(GameSetup, { name: name.value, 'onUpdate:name': (value: string) => (name.value = value) })
  },
})

function renderGameSetup() {
  const router = makeTestRouter()
  render(BoundGameSetup, { global: { plugins: [i18n, router] } })
  return router
}

async function startAs(name: string): Promise<void> {
  await fireEvent.update(screen.getByLabelText('Your name'), name)
  await fireEvent.click(screen.getByRole('button', { name: 'Start game' }))
  await flushPromises()
}

/** A promise resolved from outside, to see "checking connection…" mid-probe. */
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
  localRepository.mockReset()
  localStorage.clear()
})

describe('GameSetup name field', () => {
  it('shows no example name, so nobody copies the placeholder', () => {
    renderGameSetup()

    expect(screen.getByLabelText('Your name').getAttribute('placeholder')).toBeNull()
  })

  it('asks for a name and never probes the connection when it is empty', async () => {
    renderGameSetup()

    await fireEvent.click(screen.getByRole('button', { name: 'Start game' }))
    await flushPromises()

    expect(screen.getByText('Enter your name to continue.')).toBeTruthy()
    expect(hostRepository).not.toHaveBeenCalled()
  })
})

describe('GameSetup, this phone only', () => {
  it('starts a game on this device without checking the connection, and remembers the choice', async () => {
    localRepository.mockReturnValue(offlineMode())
    const router = renderGameSetup()

    await fireEvent.click(screen.getByRole('switch', { name: 'This device only' }))
    expect(screen.getByText(/nobody joins/)).toBeTruthy()
    await startAs('Juho')

    expect(hostRepository).not.toHaveBeenCalled()
    expect(localRepository).toHaveBeenCalled()
    expect(router.currentRoute.value.params.code).toBe('local')
    expect(localStorage.getItem('this-phone-only')).toBe('true')
  })
})

describe('GameSetup hosting online (backend reachable)', () => {
  it('starts a room under the name, alone, and goes to its code', async () => {
    const onlineRepo = makeFakeOnlineRepository('7K4RQ')
    hostRepository.mockResolvedValue({ kind: 'online', repository: onlineRepo })
    const router = renderGameSetup()
    const game = useGameStore()

    await startAs(' Juho ')

    expect(onlineRepo.createGame).toHaveBeenCalledWith(
      expect.objectContaining({ hostDisplayName: 'Juho' }),
    )
    expect(onlineRepo.addGuest).not.toHaveBeenCalled()
    expect(router.currentRoute.value.params.code).toBe('7K4RQ')
    expect(game.isHost).toBe(true)
    expect(game.isOnline).toBe(true)
  })
})

describe('GameSetup hosting offline (backend unreachable)', () => {
  it('starts a local game with just the host; the others are added in the room', async () => {
    hostRepository.mockResolvedValue(offlineMode())
    const router = renderGameSetup()
    const game = useGameStore()

    await startAs('Juho')

    expect(router.currentRoute.value.params.code).toBe('local')
    expect(game.standings.map((standing) => standing.player.name)).toEqual(['Juho'])
  })
})

describe('GameSetup when the online room cannot be created', () => {
  it('falls back to a local game', async () => {
    const repository = makeFakeOnlineRepository('7K4RQ')
    repository.createGame = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('timed out'), { code: 'deadline-exceeded' }))
    hostRepository.mockResolvedValue({ kind: 'online', repository })
    localRepository.mockReturnValue(offlineMode())
    const router = renderGameSetup()

    await startAs('Juho')

    expect(router.currentRoute.value.params.code).toBe('local')
  })
})

describe("GameSetup under someone else's claimed name", () => {
  it('says so by the name instead of falling back to a local game, until the name changes', async () => {
    const repository = makeFakeOnlineRepository('7K4RQ')
    repository.createGame = vi.fn().mockRejectedValue(new NameClaimedError('Juho'))
    hostRepository.mockResolvedValue({ kind: 'online', repository })
    const router = renderGameSetup()

    await startAs('Juho')

    const message =
      "Juho is a claimed name. If it's yours, sign in with Google on the Account page; otherwise pick another name."
    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.getByLabelText('Your name').getAttribute('aria-invalid')).toBe('true')
    expect(localRepository).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('home')

    await fireEvent.update(screen.getByLabelText('Your name'), 'Juho L')
    expect(screen.queryByText(message)).toBeNull()
  })
})

describe('GameSetup with a local game already in progress', () => {
  async function startLocalGameInProgress(): Promise<void> {
    // The real browser storage: the game a new local game would overwrite lives there.
    await new LocalGameRepository().createGame({
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Earlier host',
    })
  }

  it('asks before a new local game replaces it, and keeps it if you say so', async () => {
    await startLocalGameInProgress()
    hostRepository.mockResolvedValue(offlineMode())
    const router = renderGameSetup()
    const game = useGameStore()

    await startAs('Juho')
    expect(
      screen.getByText('Start a new game? The game in progress on this device will be lost.'),
    ).toBeTruthy()
    expect(game.gameId).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }))
    await flushPromises()

    expect(router.currentRoute.value.params.code).toBe('local')
    expect(game.gameId).toBeNull()
  })

  it('starts the new game once you confirm', async () => {
    await startLocalGameInProgress()
    hostRepository.mockResolvedValue(offlineMode())
    const router = renderGameSetup()
    const game = useGameStore()

    await startAs('Juho')
    await fireEvent.click(screen.getByRole('button', { name: 'Start new game' }))
    await flushPromises()

    expect(router.currentRoute.value.params.code).toBe('local')
    expect(game.standings.map((standing) => standing.player.name)).toEqual(['Juho'])
  })

  it('never asks when the new game is online, since that one stays on this device', async () => {
    await startLocalGameInProgress()
    hostRepository.mockResolvedValue({
      kind: 'online',
      repository: makeFakeOnlineRepository('7K4RQ'),
    })
    const router = renderGameSetup()

    await startAs('Juho')

    expect(screen.queryByText(/will be lost/)).toBeNull()
    expect(router.currentRoute.value.params.code).toBe('7K4RQ')
  })
})

describe('GameSetup connection status', () => {
  it('shows a checking-connection status while the probe/creation is pending, then clears it', async () => {
    const { promise, resolve } = deferred<HostGameMode>()
    hostRepository.mockReturnValue(promise)
    renderGameSetup()

    await startAs('Juho')

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

    await startAs('Juho')

    expect(screen.getByText("Couldn't start the game. Try again.")).toBeTruthy()
  })
})
