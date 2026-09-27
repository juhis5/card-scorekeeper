import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { render, screen, fireEvent } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import JoinGame from './JoinGame.vue'
import { useGameStore } from '@/stores/game'
import { i18n } from '@/i18n'
import type { GameRepository } from '@/lib/repository'
import type { GameState } from '@/lib/types'

// See GameSetup.test.ts's comment: mock the connectivity-checked repository seam, not the
// lower-level connectivity/Firebase modules it wraps.
const { joinRepository } = vi.hoisted(() => ({ joinRepository: vi.fn() }))

vi.mock('@/composables/useGameConnectivity', () => ({
  useGameConnectivity: () => ({ hostRepository: vi.fn(), joinRepository }),
}))

function makeFakeOnlineRepository(): GameRepository {
  return {
    createGame: vi.fn(),
    addPlayer: vi.fn().mockResolvedValue('alice-uid'),
    removePlayer: vi.fn(),
    subscribe: vi.fn((onChange: (state: GameState) => void) => {
      onChange({
        status: 'waiting',
        currentRound: 1,
        players: [{ id: 'alice-uid', name: 'Alice', totalScore: 0 }],
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

function renderJoinGame() {
  const router = makeTestRouter()
  render(JoinGame, { global: { plugins: [i18n, router] } })
  return router
}

async function fillAndSubmit(code: string, name: string): Promise<void> {
  await fireEvent.update(screen.getByLabelText('Room code'), code)
  await fireEvent.update(screen.getByLabelText('Your name'), name)
  await fireEvent.click(screen.getByRole('button', { name: 'Join game' }))
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  joinRepository.mockReset()
})

describe('JoinGame name field', () => {
  it('shows no example name, but keeps the room-code format hint', () => {
    renderJoinGame()

    expect(screen.getByLabelText('Your name').getAttribute('placeholder')).toBeNull()
    expect(screen.getByLabelText('Room code').getAttribute('placeholder')).toBe('e.g. 7K4RQ')
  })
})

describe('JoinGame validation', () => {
  it("prefills the room code from the link a room page offers ('Join room 7K4RQ')", async () => {
    const router = makeTestRouter()
    await router.push('/?code=7K4RQ')
    render(JoinGame, { global: { plugins: [i18n, router] } })

    expect((screen.getByLabelText('Room code') as HTMLInputElement).value).toBe('7K4RQ')
  })

  it('rejects a malformed room code before ever calling the backend', async () => {
    renderJoinGame()

    await fillAndSubmit('bad', 'Alice')

    expect(screen.getByText('Enter the 5-character room code exactly as shown.')).toBeTruthy()
    expect(joinRepository).not.toHaveBeenCalled()
  })

  it('requires a name', async () => {
    renderJoinGame()

    await fillAndSubmit('7K4RQ', '')

    expect(screen.getByText('Enter your name to continue.')).toBeTruthy()
    expect(joinRepository).not.toHaveBeenCalled()
  })

  it('normalizes a lower-case, whitespace-padded code before validating and sending it', async () => {
    const repo = makeFakeOnlineRepository()
    joinRepository.mockResolvedValue({ kind: 'online', repository: repo })
    const router = renderJoinGame()

    await fillAndSubmit(' abcde ', 'Alice')

    expect(joinRepository).toHaveBeenCalledWith('ABCDE')
    expect(router.currentRoute.value.params.code).toBe('ABCDE')
  })
})

describe('JoinGame joining successfully', () => {
  it('seats this device and navigates to the room with the given code', async () => {
    const repo = makeFakeOnlineRepository()
    joinRepository.mockResolvedValue({ kind: 'online', repository: repo })
    const router = renderJoinGame()
    const game = useGameStore()

    await fillAndSubmit('7K4RQ', 'Alice')

    expect(repo.addPlayer).toHaveBeenCalledWith({ name: 'Alice', deviceUuid: expect.any(String) })
    expect(router.currentRoute.value.name).toBe('room')
    expect(router.currentRoute.value.params.code).toBe('7K4RQ')
    expect(game.isHost).toBe(false)
    expect(game.myPlayerId).toBe('alice-uid')
  })
})

describe('JoinGame failure handling', () => {
  it('shows a friendly, retryable message when the backend is unreachable', async () => {
    joinRepository.mockResolvedValue({ kind: 'unreachable' })
    const router = renderJoinGame()

    await fillAndSubmit('7K4RQ', 'Alice')

    expect(
      screen.getByText("Couldn't reach the game — check your connection and try again."),
    ).toBeTruthy()
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('maps an invalid/expired room code to a friendly error, never a raw one', async () => {
    const repo = makeFakeOnlineRepository()
    repo.addPlayer = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    joinRepository.mockResolvedValue({ kind: 'online', repository: repo })
    const router = renderJoinGame()

    await fillAndSubmit('7K4RQ', 'Alice')

    expect(screen.getByText("Couldn't join that room. Check the code and try again.")).toBeTruthy()
    expect(screen.queryByText('permission-denied')).toBeNull()
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('says the game is unreachable, not that the code is wrong, when joining times out', async () => {
    const repo = makeFakeOnlineRepository()
    repo.addPlayer = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('timed out'), { code: 'deadline-exceeded' }))
    joinRepository.mockResolvedValue({ kind: 'online', repository: repo })
    renderJoinGame()

    await fillAndSubmit('7K4RQ', 'Alice')

    expect(
      screen.getByText("Couldn't reach the game — check your connection and try again."),
    ).toBeTruthy()
  })

  it('lets the user retry after a failed join', async () => {
    const failingRepo = makeFakeOnlineRepository()
    failingRepo.addPlayer = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    joinRepository.mockResolvedValueOnce({ kind: 'online', repository: failingRepo })
    renderJoinGame()

    await fillAndSubmit('7K4RQ', 'Alice')
    expect(screen.getByText("Couldn't join that room. Check the code and try again.")).toBeTruthy()

    const succeedingRepo = makeFakeOnlineRepository()
    joinRepository.mockResolvedValueOnce({ kind: 'online', repository: succeedingRepo })
    await fireEvent.click(screen.getByRole('button', { name: 'Join game' }))
    await flushPromises()

    expect(succeedingRepo.addPlayer).toHaveBeenCalled()
  })
})
