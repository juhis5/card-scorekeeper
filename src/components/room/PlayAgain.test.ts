import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import PlayAgain from './PlayAgain.vue'
import { i18n } from '@/i18n'
import { NameTakenError } from '@/lib/game/player-names'
import { useGameStore } from '@/stores/game'
import type {
  AddGuestInput,
  AddPlayerInput,
  CreatedGame,
  CreatedOnlineGame,
  GameConfig,
  ReplayableGameRepository,
  Unsubscribe,
} from '@/lib/data/repository'
import type { GameResult, GameState } from '@/lib/game/types'

const { joinRepository, localRepository, nextRoomRepository } = vi.hoisted(() => ({
  joinRepository: vi.fn(),
  localRepository: vi.fn(),
  nextRoomRepository: vi.fn(),
}))

vi.mock('@/composables/useGameConnectivity', () => ({
  useGameConnectivity: () => ({ joinRepository, localRepository, nextRoomRepository }),
}))

const FINISHED_CODE = 'ABCDE'
const NEXT_CODE = 'FGHJK'

/** An in-memory room: `roomCode` is what createGame hands out (null for a local game). */
class FakeRoom implements ReplayableGameRepository {
  private readonly listeners = new Set<(state: GameState) => void>()
  state: GameState = { status: 'waiting', currentRound: 1, players: [], roundScores: [] }
  linkedRoomCodes: string[] = []
  seatedNames: string[] = []
  addPlayerError: Error | null = null
  /** The finished room the next one came from, and whether its seats were brought along. */
  previousRoomCode: string | null = null
  hasCarriedSeats = false

  constructor(private readonly roomCode: string | null) {}

  async createGame(config: GameConfig): Promise<CreatedGame> {
    this.seatedNames.push(config.hostDisplayName)
    return { gameId: this.roomCode ?? 'local-game', roomCode: this.roomCode, hostPlayerId: 'host' }
  }

  async addPlayer(input: AddPlayerInput): Promise<string> {
    if (this.addPlayerError) throw this.addPlayerError
    this.seatedNames.push(input.name)
    return 'jani'
  }

  async addGuest(input: AddGuestInput): Promise<string> {
    this.seatedNames.push(`${input.name} (guest)`)
    return `guest-${input.name}`
  }

  subscribe(onChange: (state: GameState) => void): Unsubscribe {
    this.listeners.add(onChange)
    onChange(this.state)
    return () => this.listeners.delete(onChange)
  }

  async createNextGame(config: GameConfig, previousRoomCode: string): Promise<CreatedOnlineGame> {
    this.previousRoomCode = previousRoomCode
    const created = await this.createGame(config)
    return { ...created, roomCode: created.roomCode ?? 'NEXT2' }
  }

  async linkNextRoom(nextRoomCode: string): Promise<void> {
    this.linkedRoomCodes.push(nextRoomCode)
  }

  async carrySeats(): Promise<void> {
    this.hasCarriedSeats = true
  }

  async setRoundScore(): Promise<void> {}
  async removePlayer(): Promise<void> {}
  async advanceRound(): Promise<void> {}
  async finishGame(): Promise<GameResult> {
    return { gameId: 'game', finishedAt: 'now', totalRounds: 5 }
  }
  async abandonGame(): Promise<void> {}
  leave(): void {
    this.listeners.clear()
  }

  finish(overrides: Partial<GameState> = {}): void {
    this.state = { ...this.state, status: 'finished', currentRound: 5, ...overrides }
    this.listeners.forEach((listener) => listener(this.state))
  }
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/room/:code', name: 'room', component: { template: '<div />' } },
      { path: '/join/:code', name: 'join', component: { template: '<div />' } },
    ],
  })
}

async function renderPlayAgain(props: { myName: string; otherNames: string[] }) {
  const router = makeRouter()
  await router.push({ name: 'room', params: { code: FINISHED_CODE } })
  render(PlayAgain, { props, global: { plugins: [i18n, router] } })
  return router
}

async function finishedHostedGame(roomCode: string | null) {
  const finished = new FakeRoom(roomCode)
  await useGameStore().start(finished, { hostDeviceUuid: 'device-host', hostDisplayName: 'Juho' })
  finished.finish()
  return finished
}

async function finishedJoinedGame() {
  const finished = new FakeRoom(FINISHED_CODE)
  await useGameStore().join(finished, FINISHED_CODE, { name: 'Jani', deviceUuid: 'device-jani' })
  finished.finish()
  return finished
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  joinRepository.mockReset()
  localRepository.mockReset()
  nextRoomRepository.mockReset()
})

describe('PlayAgain after a local game', () => {
  it('starts the next local game at once, with the same players', async () => {
    await finishedHostedGame(null)
    const next = new FakeRoom(null)
    localRepository.mockReturnValue({ kind: 'offline', repository: next })
    const router = await renderPlayAgain({ myName: 'Juho', otherNames: ['Jani', 'Ripa'] })

    await fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    await flushPromises()

    expect(next.seatedNames).toEqual(['Juho', 'Jani (guest)', 'Ripa (guest)'])
    expect(useGameStore().status).toBe('waiting')
    expect(router.currentRoute.value.name).toBe('room')
    expect(nextRoomRepository).not.toHaveBeenCalled()
  })
})

describe('PlayAgain, online host', () => {
  it('creates the next room under the same name, brings everyone along and moves there', async () => {
    const finished = await finishedHostedGame(FINISHED_CODE)
    const next = new FakeRoom(NEXT_CODE)
    nextRoomRepository.mockResolvedValue({ kind: 'online', repository: next })
    const router = await renderPlayAgain({ myName: 'Juho', otherNames: ['Jani'] })

    await fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    await flushPromises()

    expect(next.seatedNames).toEqual(['Juho'])
    expect(next.previousRoomCode).toBe(FINISHED_CODE)
    expect(finished.linkedRoomCodes).toEqual([NEXT_CODE])
    expect(next.hasCarriedSeats).toBe(true)
    expect(router.currentRoute.value.params.code).toBe(NEXT_CODE)
  })

  it("says so when the server can't be reached, and a second tap tries again", async () => {
    await finishedHostedGame(FINISHED_CODE)
    nextRoomRepository.mockResolvedValueOnce({ kind: 'unreachable' })
    const router = await renderPlayAgain({ myName: 'Juho', otherNames: ['Jani'] })

    await fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    await flushPromises()

    expect(screen.getByRole('alert').textContent).toContain("Couldn't start the next game")
    expect(router.currentRoute.value.params.code).toBe(FINISHED_CODE)

    nextRoomRepository.mockResolvedValueOnce({
      kind: 'online',
      repository: new FakeRoom(NEXT_CODE),
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    await flushPromises()

    expect(router.currentRoute.value.params.code).toBe(NEXT_CODE)
  })
})

describe('PlayAgain, host back in a room that already has a next game', () => {
  it('goes to the next game instead of starting another', async () => {
    const finished = await finishedHostedGame(FINISHED_CODE)
    joinRepository.mockResolvedValue({ kind: 'online', repository: new FakeRoom(NEXT_CODE) })
    const router = await renderPlayAgain({ myName: 'Juho', otherNames: ['Jani'] })

    finished.finish({ nextRoomCode: NEXT_CODE })
    await flushPromises()
    expect(screen.queryByRole('button', { name: 'Play again' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Go to the next game' }))
    await flushPromises()

    expect(joinRepository).toHaveBeenCalledWith(NEXT_CODE)
    expect(nextRoomRepository).not.toHaveBeenCalled()
    expect(router.currentRoute.value.params.code).toBe(NEXT_CODE)
  })
})

describe('PlayAgain, the other players', () => {
  it('offers nothing until the host starts the next game', async () => {
    await finishedJoinedGame()
    await renderPlayAgain({ myName: 'Jani', otherNames: ['Juho'] })

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('moves to the next game by itself once the host has seated them there', async () => {
    const finished = await finishedJoinedGame()
    const next = new FakeRoom(NEXT_CODE)
    joinRepository.mockResolvedValue({ kind: 'online', repository: next })
    const router = await renderPlayAgain({ myName: 'Jani', otherNames: ['Juho'] })

    finished.finish({ nextRoomCode: NEXT_CODE })
    await flushPromises()
    expect(joinRepository).not.toHaveBeenCalled()
    finished.finish({ nextRoomCode: NEXT_CODE, hasSeatInNextRoom: true })
    await flushPromises()

    expect(joinRepository).toHaveBeenCalledWith(NEXT_CODE)
    expect(router.currentRoute.value.params.code).toBe(NEXT_CODE)
  })

  it('moves at once when their seat in the next game is already there as the page opens', async () => {
    const finished = await finishedJoinedGame()
    joinRepository.mockResolvedValue({ kind: 'online', repository: new FakeRoom(NEXT_CODE) })
    finished.finish({ nextRoomCode: NEXT_CODE, hasSeatInNextRoom: true })
    const router = await renderPlayAgain({ myName: 'Jani', otherNames: ['Juho'] })
    await flushPromises()

    expect(router.currentRoute.value.params.code).toBe(NEXT_CODE)
  })

  it('asks to join the next game when no seat comes, and seats them under the same name', async () => {
    const finished = await finishedJoinedGame()
    const next = new FakeRoom(NEXT_CODE)
    joinRepository.mockResolvedValue({ kind: 'online', repository: next })
    const router = await renderPlayAgain({ myName: 'Jani', otherNames: ['Juho'] })

    finished.finish({ nextRoomCode: NEXT_CODE })
    await flushPromises()
    expect(screen.getByRole('status').textContent).toBe('The host started a new game.')
    await fireEvent.click(screen.getByRole('button', { name: 'Join the next game' }))
    await flushPromises()

    expect(joinRepository).toHaveBeenCalledWith(NEXT_CODE)
    expect(next.seatedNames).toEqual(['Jani'])
    expect(router.currentRoute.value.params.code).toBe(NEXT_CODE)
  })

  it('keeps the finished game and offers another name when theirs is taken in the next game', async () => {
    const finished = await finishedJoinedGame()
    const next = new FakeRoom(NEXT_CODE)
    next.addPlayerError = new NameTakenError('Jani')
    joinRepository.mockResolvedValue({ kind: 'online', repository: next })
    await renderPlayAgain({ myName: 'Jani', otherNames: ['Juho'] })

    finished.finish({ nextRoomCode: NEXT_CODE })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: 'Join the next game' }))
    await flushPromises()

    expect(screen.getByRole('alert').textContent).toBe(
      'Someone in the next game already uses your name.',
    )
    expect(screen.getByRole('link', { name: 'Join with another name' }).getAttribute('href')).toBe(
      `/join/${NEXT_CODE}`,
    )
    expect(useGameStore().roomCode).toBe(FINISHED_CODE)
  })

  it("says so when the next game can't be reached", async () => {
    const finished = await finishedJoinedGame()
    joinRepository.mockResolvedValue({ kind: 'unreachable' })
    await renderPlayAgain({ myName: 'Jani', otherNames: ['Juho'] })

    finished.finish({ nextRoomCode: NEXT_CODE })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: 'Join the next game' }))
    await flushPromises()

    expect(screen.getByRole('alert').textContent).toContain("Couldn't reach the next game")
  })
})
