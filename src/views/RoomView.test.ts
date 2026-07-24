import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import RoomView from './RoomView.vue'
import { useGameStore } from '@/stores/game'
import { LocalGameRepository } from '@/lib/local-repository'
import type { KeyValueStorage } from '@/lib/local-repository'
import { runningTotal } from '@/lib/rules'
import { i18n } from '@/i18n'
import type {
  AddPlayerInput,
  CreatedGame,
  GameConfig,
  GameRepository,
  PlayerId,
  SetRoundScoreInput,
  Unsubscribe,
} from '@/lib/repository'
import type { ContractRoundNumber, GameResult, GameState } from '@/lib/types'

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

function makeRepository(): LocalGameRepository {
  let count = 0
  return new LocalGameRepository({
    now: () => '2026-01-01T00:00:00.000Z',
    newId: () => `id-${++count}`,
    storage: makeMemoryStorage(),
  })
}

/**
 * A minimal fake `GameRepository` that behaves like a shared Firestore room: every subscriber —
 * host or joiner — sees the same state, so a host-side and a joiner-side Pinia/store pair can be
 * driven against ONE instance to simulate two devices in the same online room, without a real
 * Firestore emulator (see the tdd skill's "mock at the boundary").
 */
class FakeOnlineRepository implements GameRepository {
  private readonly listeners = new Set<(state: GameState) => void>()
  private state: GameState = { status: 'waiting', currentRound: 1, players: [], roundScores: [] }
  private nextPlayerNumber = 1

  constructor(private readonly roomCode: string) {}

  async createGame(config: GameConfig): Promise<CreatedGame> {
    const hostId = 'host-uid'
    this.state = {
      ...this.state,
      players: [{ id: hostId, name: config.hostDisplayName, totalScore: 0 }],
    }
    this.emit()
    return { gameId: this.roomCode, roomCode: this.roomCode, hostPlayerId: hostId }
  }

  async addPlayer(input: AddPlayerInput): Promise<PlayerId> {
    const playerId = `player-${this.nextPlayerNumber++}`
    this.state = {
      ...this.state,
      players: [...this.state.players, { id: playerId, name: input.name, totalScore: 0 }],
    }
    this.emit()
    return playerId
  }

  subscribe(onChange: (state: GameState) => void): Unsubscribe {
    this.listeners.add(onChange)
    onChange(this.state)
    return () => this.listeners.delete(onChange)
  }

  async setRoundScore(input: SetRoundScoreInput): Promise<void> {
    const roundScores = [
      ...this.state.roundScores.filter(
        (score) => !(score.playerId === input.playerId && score.round === input.round),
      ),
      { round: input.round, playerId: input.playerId, points: input.points },
    ]
    const players = this.state.players.map((player) =>
      player.id === input.playerId
        ? { ...player, totalScore: runningTotal(player.id, roundScores) }
        : player,
    )
    this.state = { ...this.state, status: 'playing', players, roundScores }
    this.emit()
  }

  async advanceRound(): Promise<void> {
    const nextRound = Math.min(this.state.currentRound + 1, 5) as ContractRoundNumber
    this.state = { ...this.state, currentRound: nextRound }
    this.emit()
  }

  async finishGame(): Promise<GameResult> {
    this.state = { ...this.state, status: 'finished' }
    this.emit()
    return { gameId: this.roomCode, finishedAt: 'now', totalRounds: 5, winnerUuid: '' }
  }

  leave(): void {
    this.listeners.clear()
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.state))
  }
}

const RouterLinkStub = { template: '<a><slot /></a>' }

function renderRoom() {
  return render(RoomView, {
    global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub } },
  })
}

async function enterScore(name: string, round: number, points: number): Promise<void> {
  const input = screen.getByLabelText(`${name}'s round ${round} score`)
  await fireEvent.update(input, String(points))
  await fireEvent.blur(input)
  // The commit handler awaits an async store call before marking the player "scored" — let
  // that microtask settle before the next interaction reads button-disabled state (see the
  // tdd skill's "racing async/DOM" flakiness guidance).
  await flushPromises()
}

async function advanceOrFinish(round: number): Promise<void> {
  const buttonName = round < 5 ? 'Next round' : 'Finish game'
  await fireEvent.click(screen.getByRole('button', { name: buttonName }))
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('RoomView score entry', () => {
  it("entering a round score updates that player's total in the scoreboard", async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    renderRoom()
    await enterScore('Alice', 1, 12)

    const rows = screen.getAllByRole('row').slice(1) // drop the header row
    const aliceRow = rows.find((row) => row.textContent?.includes('Alice'))
    expect(aliceRow?.textContent).toContain('12')
  })
})

describe('RoomView invalid score entry', () => {
  it('rejects a negative score: shows an error, leaves the total unchanged, and marks nothing scored', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    renderRoom()
    await enterScore('Alice', 1, -5)

    expect(screen.getByText('Enter a whole number of 0 or more.')).toBeTruthy()
    const rows = screen.getAllByRole('row').slice(1)
    const aliceRow = rows.find((row) => row.textContent?.includes('Alice'))
    expect(aliceRow?.textContent).toContain('0')
    expect(screen.queryByText('Scored')).toBeNull()
  })

  it('rejects a fractional score the same way', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    renderRoom()
    await enterScore('Alice', 1, 12.5)

    expect(screen.getByText('Enter a whole number of 0 or more.')).toBeTruthy()
    const rows = screen.getAllByRole('row').slice(1)
    const aliceRow = rows.find((row) => row.textContent?.includes('Alice'))
    expect(aliceRow?.textContent).toContain('0')
    expect(screen.queryByText('Scored')).toBeNull()
  })

  it('commits a valid integer, marks it scored, and clears a prior error', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    renderRoom()
    await enterScore('Alice', 1, -5)
    expect(screen.getByText('Enter a whole number of 0 or more.')).toBeTruthy()

    await enterScore('Alice', 1, 12)

    expect(screen.queryByText('Enter a whole number of 0 or more.')).toBeNull()
    const rows = screen.getAllByRole('row').slice(1)
    const aliceRow = rows.find((row) => row.textContent?.includes('Alice'))
    expect(aliceRow?.textContent).toContain('12')
  })
})

describe('RoomView with no active game', () => {
  it('shows a friendly empty state with a link back home', () => {
    renderRoom()

    expect(screen.getByRole('heading', { name: 'No local game in progress' })).toBeTruthy()
    expect(screen.getByText('Start a new game from the home screen.')).toBeTruthy()
    expect(screen.getByText('Back to home')).toBeTruthy()
  })
})

describe('RoomView score entry order', () => {
  it('keeps entry rows in a stable seat order even as the scoreboard reorders', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    renderRoom()
    const seatOrder = screen
      .getAllByLabelText(/'s round 1 score$/)
      .map((input) => input.getAttribute('id'))

    // Host scores badly and drops below Alice in the (ascending-sorted) scoreboard...
    await enterScore('Host', 1, 90)

    const orderAfterCommit = screen
      .getAllByLabelText(/'s round 1 score$/)
      .map((input) => input.getAttribute('id'))

    // ...but the entry rows themselves don't reshuffle under the host's thumb mid-entry.
    expect(orderAfterCommit).toEqual(seatOrder)
  })

  it('shows a player added after this device has already mounted RoomView (seat order grows post-mount)', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })

    renderRoom()
    expect(screen.queryByLabelText("Alice's round 1 score")).toBeNull()

    // Simulates a player showing up after mount — e.g. an async first-snapshot delay online, or
    // (as reproduced here with the offline repository, which isn't filtered to a single seat) a
    // late joiner — the seatOrder ref must grow to pick them up, not stay frozen at mount time.
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await flushPromises()

    expect(screen.getByLabelText("Alice's round 1 score")).toBeTruthy()
  })
})

describe('RoomView finishing the game', () => {
  it('declares the correct winner after 5 rounds', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    renderRoom()

    for (let round = 1; round <= 5; round++) {
      await enterScore('Host', round, 50)
      await enterScore('Alice', round, 5)
      await advanceOrFinish(round)
    }

    expect(screen.getByText('Alice wins!')).toBeTruthy()
  })

  it('shows co-winners when the game ends in a tie', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await game.addPlayer({ name: 'Bob', deviceUuid: 'device-b' })

    renderRoom()

    for (let round = 1; round <= 5; round++) {
      await enterScore('Host', round, 50)
      await enterScore('Alice', round, 10)
      await enterScore('Bob', round, 10)
      await advanceOrFinish(round)
    }

    expect(screen.getByText('Alice and Bob tie for the win!')).toBeTruthy()
  })
})

describe('RoomView offline banner', () => {
  it('shows why this is a local game — this device is offline/hosting solo', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })

    renderRoom()

    expect(screen.getByText("You're offline — playing a local game on this device.")).toBeTruthy()
    expect(screen.queryByText(/Room code:/)).toBeNull()
  })
})

describe('RoomView online mode', () => {
  const ROOM_CODE = '7K4RQ'

  /** Seats a host and a joiner against the SAME fake online repository, each behind its own
   * Pinia (simulating two devices), and returns their stores + a render() for either seat. */
  async function setUpOnlineRoom() {
    const repository = new FakeOnlineRepository(ROOM_CODE)

    const hostPinia = createPinia()
    setActivePinia(hostPinia)
    const hostGame = useGameStore()
    await hostGame.start(repository, { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })

    const joinerPinia = createPinia()
    setActivePinia(joinerPinia)
    const joinerGame = useGameStore()
    const aliceId = await joinerGame.join(repository, ROOM_CODE, {
      name: 'Alice',
      deviceUuid: 'device-a',
    })

    return { repository, hostPinia, hostGame, joinerPinia, joinerGame, aliceId }
  }

  function renderAs(pinia: ReturnType<typeof createPinia>) {
    return render(RoomView, {
      global: { plugins: [pinia, i18n], stubs: { RouterLink: RouterLinkStub } },
    })
  }

  it('shows the room code prominently for the host', async () => {
    const { hostPinia } = await setUpOnlineRoom()
    setActivePinia(hostPinia)

    renderAs(hostPinia)

    expect(screen.getByText(`Room code: ${ROOM_CODE}`)).toBeTruthy()
    expect(screen.queryByText("You're offline — playing a local game on this device.")).toBeNull()
  })

  it("shows only this device's own player as an editable score row for a joiner", async () => {
    const { joinerPinia } = await setUpOnlineRoom()
    setActivePinia(joinerPinia)

    renderAs(joinerPinia)

    expect(screen.getByLabelText("Alice's round 1 score")).toBeTruthy()
    expect(screen.queryByLabelText("Host's round 1 score")).toBeNull()
  })

  it('shows Next round for the host but not for a joiner, who sees a waiting message instead', async () => {
    const { hostPinia, joinerPinia } = await setUpOnlineRoom()

    setActivePinia(hostPinia)
    const hostRender = renderAs(hostPinia)
    expect(screen.getByRole('button', { name: 'Next round' })).toBeTruthy()
    hostRender.unmount()

    setActivePinia(joinerPinia)
    renderAs(joinerPinia)
    expect(screen.queryByRole('button', { name: 'Next round' })).toBeNull()
    expect(screen.getByText('Waiting for the host to move to the next round.')).toBeTruthy()
  })

  it('lets the host advance once every seated player has scored, even though each device can only edit its own row', async () => {
    const { hostPinia, joinerGame, aliceId } = await setUpOnlineRoom()

    // Alice enters her own score from her own device/store — never through the host's RoomView,
    // which (correctly) can't render an editable row for anyone but the host.
    await joinerGame.setRoundScore({ playerId: aliceId, round: 1, points: 5 })

    setActivePinia(hostPinia)
    renderAs(hostPinia)
    await enterScore('Host', 1, 50)

    const nextButton = screen.getByRole('button', { name: 'Next round' }) as HTMLButtonElement
    expect(nextButton.disabled).toBe(false)
  })
})
