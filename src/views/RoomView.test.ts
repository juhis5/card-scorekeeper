import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import RoomView from './RoomView.vue'
import { useGameStore } from '@/stores/game'
import { LocalGameRepository } from '@/lib/local-repository'
import type { KeyValueStorage } from '@/lib/local-repository'
import { LOCAL_GAME_ROUTE_CODE } from '@/lib/local-game-route'
import { runningTotal } from '@/lib/rules'
import { i18n } from '@/i18n'
import type {
  AddGuestInput,
  AddPlayerInput,
  CreatedGame,
  GameConfig,
  GameRepository,
  PlayerId,
  Seat,
  SetRoundScoreInput,
  Unsubscribe,
} from '@/lib/repository'
import type { ContractRoundNumber, GameResult, GameState } from '@/lib/types'

// RoomView resumes an online room after a reload through this seam; tests hand it a fake room.
const { resumeRepository } = vi.hoisted(() => ({ resumeRepository: vi.fn() }))
vi.mock('@/composables/useGameConnectivity', () => ({
  useGameConnectivity: () => ({ resumeRepository }),
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

function makeRepository(): LocalGameRepository {
  let count = 0
  return new LocalGameRepository({
    now: () => '2026-01-01T00:00:00.000Z',
    newId: () => `id-${++count}`,
    storage: makeMemoryStorage(),
  })
}

/** A local repository whose saves can be made to reject, standing in for a write the backend
 * refuses (offline too long, expired room, rules). */
class FailingRepository extends LocalGameRepository {
  failure: unknown = null

  override async setRoundScore(input: SetRoundScoreInput): Promise<void> {
    if (this.failure) throw this.failure
    return super.setRoundScore(input)
  }

  override async advanceRound(): Promise<void> {
    if (this.failure) throw this.failure
    return super.advanceRound()
  }

  override async finishGame(): Promise<GameResult> {
    if (this.failure) throw this.failure
    return super.finishGame()
  }
}

function makeFailingRepository(): FailingRepository {
  let count = 0
  return new FailingRepository({
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

  async addGuest(input: AddGuestInput): Promise<PlayerId> {
    const playerId = `guest-${this.nextPlayerNumber++}`
    this.state = {
      ...this.state,
      players: [
        ...this.state.players,
        { id: playerId, name: input.name, totalScore: 0, isGuest: true },
      ],
    }
    this.emit()
    return playerId
  }

  private readonly errorListeners = new Set<(error: unknown) => void>()
  /** What findSeat() reports for the device asking, as after a reload. */
  seat: Seat | null = null

  subscribe(onChange: (state: GameState) => void, onError?: (error: unknown) => void): Unsubscribe {
    this.listeners.add(onChange)
    if (onError) this.errorListeners.add(onError)
    onChange(this.state)
    return () => {
      this.listeners.delete(onChange)
      if (onError) this.errorListeners.delete(onError)
    }
  }

  async findSeat(): Promise<Seat | null> {
    return this.seat
  }

  /** Stops every device's live connection with `error`, as a dropped or refused listener would. */
  failConnection(error: unknown): void {
    this.errorListeners.forEach((listener) => listener(error))
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

  async removePlayer(playerId: PlayerId): Promise<void> {
    this.state = {
      ...this.state,
      players: this.state.players.filter((player) => player.id !== playerId),
      roundScores: this.state.roundScores.filter((score) => score.playerId !== playerId),
    }
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
    return { gameId: this.roomCode, finishedAt: 'now', totalRounds: 5 }
  }

  leave(): void {
    this.listeners.clear()
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.state))
  }
}

const RouterLinkStub = { template: '<a><slot /></a>' }

/** A minimal real router — RoomView reads `route.params.code` (to gate resume() to the local
 * sentinel route; see stores/game.ts + lib/local-game-route.ts), so `useRoute()` needs an
 * actually-installed router, not just the `RouterLink` stub used for navigation elsewhere. */
function makeTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/room/:code', name: 'room', component: { template: '<div />' } },
    ],
  })
}

/** Navigates a fresh test router to `/room/:code` and mounts RoomView there — `routeCode`
 * defaults to the local-game sentinel since most of this file's tests are local games. */
async function renderRoomAt(routeCode: string) {
  const router = makeTestRouter()
  await router.push(`/room/${routeCode}`)
  return render(RoomView, {
    global: { plugins: [router, i18n], stubs: { RouterLink: RouterLinkStub } },
  })
}

function renderRoom() {
  return renderRoomAt(LOCAL_GAME_ROUTE_CODE)
}

async function enterScore(name: string, round: number, points: number): Promise<void> {
  // ScoreCard starts collapsed — click the card header to expand it
  const cardButton = screen.getByRole('button', {
    name: new RegExp(`^(Enter|Edit) ${name}'s score`),
  })
  if (!screen.queryByLabelText(`${name}'s round ${round} score`)) {
    await fireEvent.click(cardButton)
  }
  const input = screen.getByLabelText(`${name}'s round ${round} score`)
  await fireEvent.update(input, String(points))
  await fireEvent.blur(input)
  await flushPromises()
}

async function advanceOrFinish(round: number): Promise<void> {
  const buttonName = round < 5 ? 'Next round' : 'Finish game'
  await fireEvent.click(screen.getByRole('button', { name: buttonName }))
  await flushPromises()
}

beforeEach(() => {
  resumeRepository.mockReset()
  resumeRepository.mockResolvedValue(null)
  setActivePinia(createPinia())
  // RoomView's resume() reads real browser localStorage by default (see the "resume after
  // reload" describe block below, which seeds it directly with the real `LocalGameRepository`
  // default storage). Cleared before EVERY test, file-wide — not just within that describe block
  // — so a persisted game from one test can never leak into an unrelated test's mount, whatever
  // order `--sequence.shuffle` happens to run them in (found by exactly that shuffle run).
  localStorage.clear()
})

describe('RoomView score entry', () => {
  it('shows a round on the board as entered, then reveals its scores when the host moves on', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    await renderRoom()
    await enterScore('Host', 1, 20)
    await enterScore('Alice', 1, 10)

    const aliceRow = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .find((row) => row.textContent?.includes('Alice'))
    expect(aliceRow()?.textContent).toContain('Entered')
    expect(aliceRow()?.textContent).not.toContain('10')

    await advanceOrFinish(1)

    expect(aliceRow()?.textContent).toContain('10')
    expect(aliceRow()?.textContent).not.toContain('Entered')
  })

  it('marks no leader until the first round is complete', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await renderRoom()

    expect(screen.queryByText('Leader')).toBeNull()
    await enterScore('Host', 1, 20)
    await enterScore('Alice', 1, 10)
    expect(screen.queryByText('Leader')).toBeNull()

    await advanceOrFinish(1)

    const leaderRow = screen.getAllByRole('row').find((row) => row.textContent?.includes('Leader'))
    expect(leaderRow?.textContent).toContain('Alice')
  })

  it('shows the host the points it entered, on every card it can edit', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await renderRoom()

    await enterScore('Alice', 1, 15)

    expect(screen.getByRole('button', { name: "Edit Alice's score (15 points)" })).toBeTruthy()
    expect(screen.getByText('15 pts')).toBeTruthy()
  })
})

describe('RoomView moving to the next round', () => {
  async function startWithAlice(): Promise<void> {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
  }

  function liveRegion(container: Element): string {
    return container.querySelector('[aria-live="polite"]')?.textContent ?? ''
  }

  it('moves on with one tap when the last score is still being typed', async () => {
    await startWithAlice()
    await renderRoom()
    await enterScore('Host', 1, 20)
    await fireEvent.click(screen.getByRole('button', { name: "Enter Alice's score" }))
    await fireEvent.update(screen.getByLabelText("Alice's round 1 score"), '10')

    // The tap on Next blurs the input, which saves the score, just before the click lands.
    void fireEvent.blur(screen.getByLabelText("Alice's round 1 score"))
    await fireEvent.click(screen.getByRole('button', { name: 'Next round' }))
    await flushPromises()

    expect(screen.getByRole('heading', { name: 'Round 2 scores' })).toBeTruthy()
  })

  it('says whose scores are missing when Next is tapped too early, and stays put', async () => {
    await startWithAlice()
    await renderRoom()
    await enterScore('Host', 1, 20)

    await fireEvent.click(screen.getByRole('button', { name: 'Next round' }))
    await flushPromises()

    expect(screen.getByText('Still waiting for scores from Alice.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Round 1 scores' })).toBeTruthy()
  })

  it('announces the revealed results, your place and the next contract in one message', async () => {
    await startWithAlice()
    const { container } = await renderRoom()
    await enterScore('Host', 1, 20)
    await enterScore('Alice', 1, 10)

    await advanceOrFinish(1)
    await flushPromises()

    const message = liveRegion(container)
    expect(message).toContain('Round 1 results: Alice leads with 10 points.')
    expect(message).toContain("You're in place 2.")
    expect(message).toContain('Round 2 of 5')
  })

  it('announces nothing about results when a game in progress is reopened', async () => {
    const seed = new LocalGameRepository({ now: () => '2026-01-01T00:00:00.000Z' })
    const created = await seed.createGame({
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Host',
    })
    const aliceId = await seed.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await seed.setRoundScore({ playerId: created.hostPlayerId, round: 1, points: 20 })
    await seed.setRoundScore({ playerId: aliceId, round: 1, points: 10 })
    await seed.advanceRound()
    seed.leave()

    const { container } = await renderRoom()
    await flushPromises()

    expect(screen.getByRole('heading', { name: 'Round 2 scores' })).toBeTruthy()
    expect(liveRegion(container)).not.toContain('results')
  })
})

describe('RoomView invalid score entry', () => {
  it('rejects a negative score: shows an error, leaves the total unchanged, and marks nothing scored', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    await renderRoom()
    await enterScore('Alice', 1, -5)

    expect(screen.getByText('Enter a multiple of 5 from 0 to 1,000.')).toBeTruthy()
    const rows = screen.getAllByRole('row').slice(1)
    const aliceRow = rows.find((row) => row.textContent?.includes('Alice'))
    expect(aliceRow?.textContent).toContain('0')
    expect(screen.queryByText('Scored')).toBeNull()
  })

  it('rejects a fractional score the same way', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    await renderRoom()
    await enterScore('Alice', 1, 5.5)

    expect(screen.getByText('Enter a multiple of 5 from 0 to 1,000.')).toBeTruthy()
    const rows = screen.getAllByRole('row').slice(1)
    const aliceRow = rows.find((row) => row.textContent?.includes('Alice'))
    expect(aliceRow?.textContent).toContain('0')
    expect(screen.queryByText('Scored')).toBeNull()
  })

  it('commits a valid integer, marks it scored, and clears a prior error', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    await renderRoom()
    await enterScore('Alice', 1, -5)
    expect(screen.getByText('Enter a multiple of 5 from 0 to 1,000.')).toBeTruthy()

    await enterScore('Alice', 1, 10)

    expect(screen.queryByText('Enter a multiple of 5 from 0 to 1,000.')).toBeNull()
    expect(screen.getByRole('button', { name: "Edit Alice's score (10 points)" })).toBeTruthy()
  })
})

describe('RoomView with no active game', () => {
  it('shows a friendly empty state with a link back home', async () => {
    await renderRoom()

    expect(screen.getByRole('heading', { name: 'No local game in progress' })).toBeTruthy()
    expect(screen.getByText('Start a new game from the home screen.')).toBeTruthy()
    expect(screen.getByText('Back to home')).toBeTruthy()
  })
})

describe('RoomView resume after reload (slice 5 offline robustness)', () => {
  // RoomView's resume() call (on mount, with no active store game) uses the real browser
  // localStorage by default — the same boundary a hard page reload actually loses and restores
  // from — so these tests seed it directly (the file-wide `beforeEach` above clears it first).

  it('resumes a persisted local game on mount instead of showing the empty state', async () => {
    let count = 0
    const seed = new LocalGameRepository({
      now: () => '2026-01-01T00:00:00.000Z',
      newId: () => `id-${++count}`,
    })
    await seed.createGame({ hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await seed.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    seed.leave()

    await renderRoom()
    // resume() runs inside onMounted, so the state it reads back is applied reactively — same
    // "await a tick before asserting" need as the seat-order growth test above.
    await flushPromises()

    expect(screen.queryByRole('heading', { name: 'No local game in progress' })).toBeNull()
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.some((row) => row.textContent?.includes('Alice'))).toBe(true)
  })

  it('lets a resumed game continue accepting score entry', async () => {
    const seed = new LocalGameRepository({ now: () => '2026-01-01T00:00:00.000Z' })
    await seed.createGame({ hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await seed.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    seed.leave()

    await renderRoom()
    await flushPromises()
    await enterScore('Alice', 1, 10)

    expect(screen.getByRole('button', { name: "Edit Alice's score (10 points)" })).toBeTruthy()
  })

  it('still shows the empty state when nothing is persisted', async () => {
    await renderRoom()

    expect(screen.getByRole('heading', { name: 'No local game in progress' })).toBeTruthy()
  })

  it('never resumes a stale local game onto an ONLINE room route — the two must never mix', async () => {
    // A leftover local game from an earlier offline session sits in localStorage. Reloading a
    // real online room (a different, non-'local' route code) must NOT resurrect it — that would
    // silently show the wrong game instead of the online room the URL actually asked for.
    const seed = new LocalGameRepository({ now: () => '2026-01-01T00:00:00.000Z' })
    await seed.createGame({ hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await seed.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    seed.leave()

    await renderRoomAt('7K4RQ')
    await flushPromises()

    // This device has no seat in 7K4RQ, so it's offered a rejoin — never Alice's stale local
    // game just because one happens to be sitting in storage.
    expect(
      screen.getByRole('heading', { name: "This room isn't open on this device" }),
    ).toBeTruthy()
    expect(screen.queryByText('Alice')).toBeNull()
  })
})

describe('RoomView score entry order', () => {
  it('keeps entry cards in a stable seat order even as the scoreboard reorders', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    await renderRoom()
    const getCardNames = () =>
      screen.getAllByRole('button', { name: /^(enter|edit) .+'s score/i }).map((button) => {
        const label = button.getAttribute('aria-label') ?? ''
        // Extract player name from "Enter <name>'s score" or "Edit <name>'s score (scored)"
        const match = label.match(/(?:Enter|Edit) (.+?)'s score/)
        return match?.[1] ?? label
      })
    const seatOrder = getCardNames()

    // Host scores badly and drops below Alice in the (ascending-sorted) scoreboard...
    await enterScore('Host', 1, 90)

    const orderAfterCommit = getCardNames()

    // ...but the entry cards themselves don't reshuffle under the host's thumb mid-entry.
    expect(orderAfterCommit).toEqual(seatOrder)
  })

  it('shows a player added after this device has already mounted RoomView (seat order grows post-mount)', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })

    await renderRoom()
    expect(screen.queryByRole('button', { name: /alice/i })).toBeNull()

    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await flushPromises()

    expect(screen.getByRole('button', { name: /alice/i })).toBeTruthy()
  })
})

describe('RoomView finishing the game', () => {
  it('declares the correct winner after 5 rounds', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    await renderRoom()

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

    await renderRoom()

    for (let round = 1; round <= 5; round++) {
      await enterScore('Host', round, 50)
      await enterScore('Alice', round, 10)
      await enterScore('Bob', round, 10)
      await advanceOrFinish(round)
    }

    expect(screen.getByText('Alice and Bob tie for the win!')).toBeTruthy()
  })

  it("offers Play again with this game's names, host first and in seat order", async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await game.addPlayer({ name: 'Bob', deviceUuid: 'device-b' })
    const router = makeTestRouter()
    await router.push(`/room/${LOCAL_GAME_ROUTE_CODE}`)
    render(RoomView, {
      global: { plugins: [router, i18n], stubs: { RouterLink: RouterLinkStub } },
    })

    for (let round = 1; round <= 5; round++) {
      await enterScore('Host', round, 50)
      await enterScore('Alice', round, 5)
      await enterScore('Bob', round, 10)
      await advanceOrFinish(round)
    }
    await fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
    expect(router.options.history.state.playAgainNames).toEqual(['Host', 'Alice', 'Bob'])
  })
})

describe('RoomView when a save fails', () => {
  async function startFailingGame(): Promise<FailingRepository> {
    const repository = makeFailingRepository()
    const game = useGameStore()
    await game.start(repository, { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await renderRoom()
    return repository
  }

  it('says the score was not saved and leaves the player unscored', async () => {
    const repository = await startFailingGame()
    repository.failure = new Error('offline')

    await enterScore('Alice', 1, 10)

    expect(screen.getByRole('alert').textContent).toContain(
      "Couldn't save Alice's score. Check your connection and enter it again.",
    )
    expect(screen.getByRole('button', { name: "Enter Alice's score" })).toBeTruthy()
  })

  it('explains that the room is closed when the rules refuse the write', async () => {
    const repository = await startFailingGame()
    repository.failure = Object.assign(new Error('denied'), { code: 'permission-denied' })

    await enterScore('Alice', 1, 10)

    expect(screen.getByRole('alert').textContent).toContain(
      "This room isn't accepting changes anymore. It may have expired.",
    )
  })

  it('says the next round did not start and stays on the current round', async () => {
    const repository = await startFailingGame()
    await enterScore('Host', 1, 20)
    await enterScore('Alice', 1, 10)
    repository.failure = new Error('offline')

    await advanceOrFinish(1)

    expect(screen.getByRole('alert').textContent).toContain(
      "Couldn't start the next round. Try again.",
    )
    expect(screen.getByRole('heading', { name: 'Round 1 scores' })).toBeTruthy()
  })

  it('says the game did not finish and keeps the Finish button', async () => {
    const repository = await startFailingGame()
    for (let round = 1; round <= 4; round++) {
      await enterScore('Host', round, 20)
      await enterScore('Alice', round, 10)
      await advanceOrFinish(round)
    }
    await enterScore('Host', 5, 20)
    await enterScore('Alice', 5, 10)
    repository.failure = new Error('offline')

    await advanceOrFinish(5)

    expect(screen.getByRole('alert').textContent).toContain("Couldn't finish the game. Try again.")
    expect(screen.getByRole('button', { name: 'Finish game' })).toBeTruthy()
  })

  it('clears the message once a later save succeeds', async () => {
    const repository = await startFailingGame()
    repository.failure = new Error('offline')
    await enterScore('Alice', 1, 10)
    repository.failure = null

    await enterScore('Alice', 1, 10)

    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('RoomView offline banner', () => {
  it('shows why this is a local game — this device is offline/hosting solo', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })

    await renderRoom()

    expect(
      screen.getByText(
        "Playing a local game on this device. Others can't join, and photo count is off.",
      ),
    ).toBeTruthy()
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

  // Every online-room render needs a router at the REAL room code, not the local sentinel — see
  // renderRoomAt's doc comment above; onMounted's resume() gate depends on telling them apart.
  async function renderAs(pinia: ReturnType<typeof createPinia>) {
    const router = makeTestRouter()
    await router.push(`/room/${ROOM_CODE}`)
    return render(RoomView, {
      global: { plugins: [pinia, router, i18n], stubs: { RouterLink: RouterLinkStub } },
    })
  }

  it('shows no local-game banner in an online room (the header shows its code)', async () => {
    const { hostPinia } = await setUpOnlineRoom()
    setActivePinia(hostPinia)

    await renderAs(hostPinia)

    expect(
      screen.queryByText(
        "Playing a local game on this device. Others can't join, and photo count is off.",
      ),
    ).toBeNull()
  })

  it("shows only this device's own player as an editable score card for a joiner", async () => {
    const { joinerPinia } = await setUpOnlineRoom()
    setActivePinia(joinerPinia)

    await renderAs(joinerPinia)

    // A joiner's own card reads "Enter your points", not their name.
    expect(screen.getByRole('button', { name: 'Enter your points' })).toBeTruthy()
    // Host's card should not appear for the joiner
    expect(screen.queryByRole('button', { name: /host/i })).toBeNull()
  })

  it('shows Next round for the host but not for a joiner, who sees a waiting message instead', async () => {
    const { hostPinia, joinerPinia } = await setUpOnlineRoom()

    setActivePinia(hostPinia)
    const hostRender = await renderAs(hostPinia)
    expect(screen.getByRole('button', { name: 'Next round' })).toBeTruthy()
    hostRender.unmount()

    setActivePinia(joinerPinia)
    await renderAs(joinerPinia)
    expect(screen.queryByRole('button', { name: 'Next round' })).toBeNull()
    expect(screen.getByText('Waiting for the host to move to the next round.')).toBeTruthy()
  })

  it('lets the host advance once every seated player has scored, even though each device can only edit its own row', async () => {
    const { hostPinia, joinerGame, aliceId } = await setUpOnlineRoom()

    // Alice enters her own score from her own device/store.
    await joinerGame.setRoundScore({ playerId: aliceId, round: 1, points: 5 })

    setActivePinia(hostPinia)
    await renderAs(hostPinia)
    await enterScore('Host', 1, 50)

    const nextButton = screen.getByRole('button', { name: 'Next round' }) as HTMLButtonElement
    expect(nextButton.disabled).toBe(false)
  })

  it("lets the host enter another player's score", async () => {
    const { hostPinia, hostGame, aliceId } = await setUpOnlineRoom()
    setActivePinia(hostPinia)
    await renderAs(hostPinia)

    await enterScore('Alice', 1, 10)

    expect(hostGame.roundScores).toContainEqual({ playerId: aliceId, round: 1, points: 10 })
  })

  it('lets the host remove another player after confirming', async () => {
    const { hostPinia, hostGame } = await setUpOnlineRoom()
    setActivePinia(hostPinia)
    await renderAs(hostPinia)

    await fireEvent.click(screen.getByRole('button', { name: "Enter Alice's score" }))
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Alice' }))
    await flushPromises()

    expect(hostGame.standings.map((standing) => standing.player.name)).toEqual(['Host'])
    expect(screen.getByText('Alice was removed from the game.')).toBeTruthy()
  })

  it('says both "removed" and "everyone has entered" when the last player still to score is removed', async () => {
    const { hostPinia, hostGame } = await setUpOnlineRoom()
    await hostGame.setRoundScore({ playerId: 'host-uid', round: 1, points: 20 })
    setActivePinia(hostPinia)
    const { container } = await renderAs(hostPinia)

    await fireEvent.click(screen.getByRole('button', { name: "Enter Alice's score" }))
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Alice' }))
    await flushPromises()

    const message = container.querySelector('[aria-live="polite"]')?.textContent ?? ''
    expect(message).toContain('Alice was removed from the game.')
    expect(message).toContain('Everyone has entered round 1 scores.')
  })

  it("never offers removing the host's own seat", async () => {
    const { hostPinia } = await setUpOnlineRoom()
    setActivePinia(hostPinia)
    await renderAs(hostPinia)

    await fireEvent.click(screen.getByRole('button', { name: "Enter Host's score" }))

    expect(screen.queryByRole('button', { name: 'Remove Host' })).toBeNull()
  })

  it('shows a joiner the points they saved on their own card', async () => {
    const { joinerPinia } = await setUpOnlineRoom()
    setActivePinia(joinerPinia)
    await renderAs(joinerPinia)

    await fireEvent.click(screen.getByRole('button', { name: 'Enter your points' }))
    await fireEvent.update(screen.getByLabelText('Your round 1 points'), '15')
    await fireEvent.blur(screen.getByLabelText('Your round 1 points'))
    await flushPromises()

    expect(screen.getByRole('button', { name: 'Enter your points (15 points saved)' })).toBeTruthy()
    expect(screen.getByText('15 pts')).toBeTruthy()
  })

  it("shows the host only 'Scored' for points a player entered themselves", async () => {
    const { hostPinia, joinerGame, aliceId } = await setUpOnlineRoom()
    await joinerGame.setRoundScore({ playerId: aliceId, round: 1, points: 20 })
    setActivePinia(hostPinia)
    await renderAs(hostPinia)
    await flushPromises()

    expect(screen.getByRole('button', { name: "Edit Alice's score (scored)" })).toBeTruthy()
    expect(screen.queryByText('20 pts')).toBeNull()
  })

  it('tells the host when the last score comes in from another device', async () => {
    const { hostPinia, hostGame, joinerGame, aliceId } = await setUpOnlineRoom()
    setActivePinia(hostPinia)
    const { container } = await renderAs(hostPinia)
    await hostGame.setRoundScore({ playerId: 'host-uid', round: 1, points: 20 })
    await flushPromises()

    await joinerGame.setRoundScore({ playerId: aliceId, round: 1, points: 10 })
    await flushPromises()

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'Everyone has entered round 1 scores.',
    )
  })

  it('never offers removing players to a joiner', async () => {
    const { joinerPinia } = await setUpOnlineRoom()
    setActivePinia(joinerPinia)
    await renderAs(joinerPinia)

    await fireEvent.click(screen.getByRole('button', { name: 'Enter your points' }))

    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
  })
})

describe('RoomView after a reload of an online room', () => {
  const ROOM_CODE = '7K4RQ'

  async function renderAt(pinia: ReturnType<typeof createPinia>) {
    const router = makeTestRouter()
    await router.push(`/room/${ROOM_CODE}`)
    const view = render(RoomView, {
      global: { plugins: [pinia, router, i18n], stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()
    return view
  }

  /** The host created the room on one page load; the reloaded page starts with an empty store. */
  async function roomCreatedBeforeReload(): Promise<FakeOnlineRepository> {
    const room = new FakeOnlineRepository(ROOM_CODE)
    setActivePinia(createPinia())
    await useGameStore().start(room, { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    return room
  }

  it('puts the host back in their room with host controls', async () => {
    const room = await roomCreatedBeforeReload()
    room.seat = { playerId: 'host-uid', isHost: true }
    resumeRepository.mockResolvedValue(room)
    const reloaded = createPinia()
    setActivePinia(reloaded)

    await renderAt(reloaded)

    expect(screen.getByRole('heading', { name: 'Round 1 scores' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next round' })).toBeTruthy()
  })

  it('offers to join again when this device has no seat in the room', async () => {
    const room = await roomCreatedBeforeReload()
    room.seat = null
    resumeRepository.mockResolvedValue(room)
    const reloaded = createPinia()
    setActivePinia(reloaded)

    await renderAt(reloaded)

    expect(
      screen.getByRole('heading', { name: "This room isn't open on this device" }),
    ).toBeTruthy()
    expect(screen.getByText('Join room 7K4RQ')).toBeTruthy()
  })

  it('shows that the room is opening while its seat is looked up', async () => {
    resumeRepository.mockReturnValue(new Promise(() => undefined))
    const reloaded = createPinia()
    setActivePinia(reloaded)

    await renderAt(reloaded)

    expect(screen.getByRole('heading', { name: 'Opening room 7K4RQ…' })).toBeTruthy()
  })
})

describe('RoomView when the live connection stops', () => {
  const ROOM_CODE = '7K4RQ'

  async function joinedRoom(): Promise<FakeOnlineRepository> {
    const room = new FakeOnlineRepository(ROOM_CODE)
    setActivePinia(createPinia())
    await useGameStore().start(room, { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    const router = makeTestRouter()
    await router.push(`/room/${ROOM_CODE}`)
    render(RoomView, {
      global: { plugins: [router, i18n], stubs: { RouterLink: RouterLinkStub } },
    })
    return room
  }

  it('says the connection was lost and how to reconnect', async () => {
    const room = await joinedRoom()

    room.failConnection(Object.assign(new Error('offline'), { code: 'unavailable' }))
    await flushPromises()

    expect(screen.getByRole('alert').textContent).toContain(
      'Lost the live connection to this room. Reload the page to reconnect.',
    )
  })

  it('says this device is no longer in the room when the rules refuse it', async () => {
    const room = await joinedRoom()

    room.failConnection(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    await flushPromises()

    expect(screen.getByRole('alert').textContent).toContain(
      "You're no longer in this room. The host may have removed you, or the room has closed.",
    )
  })
})

describe('RoomView late joiners', () => {
  const ROOM_CODE = '7K4RQ'

  /** The host plays round 1 alone and moves on; Alice joins the app during round 2. */
  async function setUpLateJoin() {
    const repository = new FakeOnlineRepository(ROOM_CODE)

    const hostPinia = createPinia()
    setActivePinia(hostPinia)
    const hostGame = useGameStore()
    await hostGame.start(repository, { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await hostGame.setRoundScore({ playerId: 'host-uid', round: 1, points: 20 })
    await hostGame.advanceRound()

    const joinerPinia = createPinia()
    setActivePinia(joinerPinia)
    const joinerGame = useGameStore()
    const aliceId = await joinerGame.join(repository, ROOM_CODE, {
      name: 'Alice',
      deviceUuid: 'device-a',
    })

    return { hostPinia, hostGame, joinerPinia, joinerGame, aliceId }
  }

  async function renderAs(pinia: ReturnType<typeof createPinia>) {
    const router = makeTestRouter()
    await router.push(`/room/${ROOM_CODE}`)
    return render(RoomView, {
      global: { plugins: [pinia, router, i18n], stubs: { RouterLink: RouterLinkStub } },
    })
  }

  it('shows a late joiner a card for each round they missed, next to the current round', async () => {
    const { joinerPinia } = await setUpLateJoin()
    setActivePinia(joinerPinia)
    await renderAs(joinerPinia)

    expect(screen.getByRole('heading', { name: 'Missed rounds' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Enter your points for missed round 1' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enter your points' })).toBeTruthy()
  })

  it('saves a missed-round score for that round', async () => {
    const { joinerPinia, joinerGame, aliceId } = await setUpLateJoin()
    setActivePinia(joinerPinia)
    await renderAs(joinerPinia)

    await fireEvent.click(
      screen.getByRole('button', { name: 'Enter your points for missed round 1' }),
    )
    await fireEvent.update(screen.getByLabelText('Your round 1 points'), '15')
    await fireEvent.blur(screen.getByLabelText('Your round 1 points'))
    await flushPromises()

    expect(joinerGame.roundScores).toContainEqual({ playerId: aliceId, round: 1, points: 15 })
    expect(screen.queryByRole('heading', { name: 'Missed rounds' })).toBeNull()
  })

  it('keeps Next disabled until the late joiner has filled in every missed round', async () => {
    const { hostPinia, hostGame, joinerGame, aliceId } = await setUpLateJoin()
    await hostGame.setRoundScore({ playerId: 'host-uid', round: 2, points: 10 })
    await joinerGame.setRoundScore({ playerId: aliceId, round: 2, points: 5 })
    setActivePinia(hostPinia)
    await renderAs(hostPinia)
    const nextButton = () => screen.getByRole('button', { name: 'Next round' })

    expect(nextButton().getAttribute('aria-disabled')).toBe('true')

    await joinerGame.setRoundScore({ playerId: aliceId, round: 1, points: 15 })
    await flushPromises()
    expect(nextButton().getAttribute('aria-disabled')).toBe('false')
  })

  it('lets the host fill in a missed round for the late joiner', async () => {
    const { hostPinia } = await setUpLateJoin()
    setActivePinia(hostPinia)
    await renderAs(hostPinia)

    expect(screen.getByRole('button', { name: "Fill in Alice's missed round 1" })).toBeTruthy()
  })
})

describe("RoomView entering everyone's points at once", () => {
  it('lets the host go through everyone missing a score, after which Next is ready', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await game.addPlayer({ name: 'Bob', deviceUuid: 'device-b' })
    await renderRoom()
    await enterScore('Host', 1, 20)

    await fireEvent.click(screen.getByRole('button', { name: 'Enter all' }))
    await flushPromises()
    expect(screen.getByRole('dialog', { name: 'Enter points · 1/2' })).toBeTruthy()
    for (const points of ['10', '5']) {
      await fireEvent.update(screen.getByRole('spinbutton'), points)
      await fireEvent.click(screen.getByRole('button', { name: 'Save and next' }))
      await flushPromises()
    }

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enter all' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Next round' }).getAttribute('aria-disabled')).toBe(
      'false',
    )
  })
})

describe('RoomView players the host adds', () => {
  const ROOM_CODE = '7K4RQ'

  async function renderOnlineHost() {
    const repository = new FakeOnlineRepository(ROOM_CODE)
    const pinia = createPinia()
    setActivePinia(pinia)
    const game = useGameStore()
    await game.start(repository, { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    const router = makeTestRouter()
    await router.push(`/room/${ROOM_CODE}`)
    render(RoomView, {
      global: { plugins: [pinia, router, i18n], stubs: { RouterLink: RouterLinkStub } },
    })
    return { repository, game }
  }

  it('adds a player mid-game, who then fills in the rounds they missed', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await renderRoom()
    await enterScore('Host', 1, 20)
    await enterScore('Alice', 1, 10)
    await advanceOrFinish(1)

    await fireEvent.click(screen.getByRole('button', { name: 'Add player' }))
    await fireEvent.update(screen.getByLabelText("Player's name"), 'Ripa')
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await flushPromises()

    expect(screen.getByRole('button', { name: "Fill in Ripa's missed round 1" })).toBeTruthy()
    expect(screen.getByText('Ripa added.')).toBeTruthy()
  })

  it("shows the host a guest's numbers, even ones not entered on this device", async () => {
    const { repository, game } = await renderOnlineHost()
    const guestId = await game.addGuest({ name: 'Mummo' })

    await repository.setRoundScore({ playerId: guestId, round: 1, points: 15 })
    await flushPromises()

    expect(screen.getByRole('button', { name: "Edit Mummo's score (15 points)" })).toBeTruthy()
    expect(screen.getByRole('row', { name: /Mummo/ }).textContent).toContain('guest')
  })

  it('offers Add player and Enter all to the host only', async () => {
    const repository = new FakeOnlineRepository(ROOM_CODE)
    const hostPinia = createPinia()
    setActivePinia(hostPinia)
    await useGameStore().start(repository, {
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Host',
    })
    const joinerPinia = createPinia()
    setActivePinia(joinerPinia)
    await useGameStore().join(repository, ROOM_CODE, { name: 'Alice', deviceUuid: 'device-a' })
    const router = makeTestRouter()
    await router.push(`/room/${ROOM_CODE}`)

    render(RoomView, {
      global: { plugins: [joinerPinia, router, i18n], stubs: { RouterLink: RouterLinkStub } },
    })

    expect(screen.queryByRole('button', { name: 'Add player' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enter all' })).toBeNull()
  })
})

describe('RoomView reconnecting indicator (slice 5 offline robustness)', () => {
  const ROOM_CODE = '7K4RQ'

  /** Restores the real navigator.onLine value so a test's stub never leaks into another file's
   * shared happy-dom window. */
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('shows a subtle "reconnecting" status distinct from the never-connected banner, on an offline event mid-online-game', async () => {
    const repository = new FakeOnlineRepository(ROOM_CODE)
    const game = useGameStore()
    await game.start(repository, { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })

    await renderRoomAt(ROOM_CODE)
    expect(
      screen.queryByText('Reconnecting… your scores are safe and will sync automatically.'),
    ).toBeNull()

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    window.dispatchEvent(new Event('offline'))
    await flushPromises()

    expect(
      screen.getByText('Reconnecting… your scores are safe and will sync automatically.'),
    ).toBeTruthy()
    // Distinct from the never-connected → local-game banner: this is a live online room.
    expect(
      screen.queryByText(
        "Playing a local game on this device. Others can't join, and photo count is off.",
      ),
    ).toBeNull()
  })

  it('clears the reconnecting status once an online event fires', async () => {
    const repository = new FakeOnlineRepository(ROOM_CODE)
    const game = useGameStore()
    await game.start(repository, { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    await renderRoomAt(ROOM_CODE)
    await flushPromises()
    expect(
      screen.getByText('Reconnecting… your scores are safe and will sync automatically.'),
    ).toBeTruthy()

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    window.dispatchEvent(new Event('online'))
    await flushPromises()

    expect(
      screen.queryByText('Reconnecting… your scores are safe and will sync automatically.'),
    ).toBeNull()
  })

  it('never shows the reconnecting status for an offline LOCAL game — that path is the persistent offline banner', async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    await renderRoom()
    await flushPromises()

    expect(
      screen.getByText(
        "Playing a local game on this device. Others can't join, and photo count is off.",
      ),
    ).toBeTruthy()
    expect(
      screen.queryByText('Reconnecting… your scores are safe and will sync automatically.'),
    ).toBeNull()
  })
})
