import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

/** A minimal real router — RoomView reads `route.params.code` (to gate resume() to the local
 * sentinel route; see stores/game.ts + lib/local-game-route.ts), so `useRoute()` needs an
 * actually-installed router, not just the `RouterLink` stub used for navigation elsewhere. */
function makeTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/room/:code', name: 'room', component: { template: '<div />' } }],
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
  const cardButton = screen.getByRole('button', { name: new RegExp(`${name}`, 'i') })
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
  setActivePinia(createPinia())
  // RoomView's resume() reads real browser localStorage by default (see the "resume after
  // reload" describe block below, which seeds it directly with the real `LocalGameRepository`
  // default storage). Cleared before EVERY test, file-wide — not just within that describe block
  // — so a persisted game from one test can never leak into an unrelated test's mount, whatever
  // order `--sequence.shuffle` happens to run them in (found by exactly that shuffle run).
  localStorage.clear()
})

describe('RoomView score entry', () => {
  it("entering a round score updates that player's total in the scoreboard", async () => {
    const game = useGameStore()
    await game.start(makeRepository(), { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await game.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    await renderRoom()
    await enterScore('Alice', 1, 10)

    const rows = screen.getAllByRole('row').slice(1) // drop the header row
    const aliceRow = rows.find((row) => row.textContent?.includes('Alice'))
    expect(aliceRow?.textContent).toContain('10')
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
    const rows = screen.getAllByRole('row').slice(1)
    const aliceRow = rows.find((row) => row.textContent?.includes('Alice'))
    expect(aliceRow?.textContent).toContain('10')
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

    const rows = screen.getAllByRole('row').slice(1)
    const aliceRow = rows.find((row) => row.textContent?.includes('Alice'))
    expect(aliceRow?.textContent).toContain('10')
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

    // No online reconnect is wired up for this test — the store legitimately has nothing yet —
    // but the point being proven is what it does NOT do: it must never fall back to Alice's
    // stale local game just because one happens to be sitting in storage.
    expect(screen.getByRole('heading', { name: 'No local game in progress' })).toBeTruthy()
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

  // Every online-room render needs a router at the REAL room code, not the local sentinel — see
  // renderRoomAt's doc comment above; onMounted's resume() gate depends on telling them apart.
  async function renderAs(pinia: ReturnType<typeof createPinia>) {
    const router = makeTestRouter()
    await router.push(`/room/${ROOM_CODE}`)
    return render(RoomView, {
      global: { plugins: [pinia, router, i18n], stubs: { RouterLink: RouterLinkStub } },
    })
  }

  it('shows the room code prominently for the host', async () => {
    const { hostPinia } = await setUpOnlineRoom()
    setActivePinia(hostPinia)

    await renderAs(hostPinia)

    expect(screen.getByText(`Room code: ${ROOM_CODE}`)).toBeTruthy()
    expect(screen.queryByText("You're offline — playing a local game on this device.")).toBeNull()
  })

  it("shows only this device's own player as an editable score card for a joiner", async () => {
    const { joinerPinia } = await setUpOnlineRoom()
    setActivePinia(joinerPinia)

    await renderAs(joinerPinia)

    expect(screen.getByRole('button', { name: /alice/i })).toBeTruthy()
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

    // Alice enters her own score from her own device/store — never through the host's RoomView,
    // which (correctly) can't render an editable row for anyone but the host.
    await joinerGame.setRoundScore({ playerId: aliceId, round: 1, points: 5 })

    setActivePinia(hostPinia)
    await renderAs(hostPinia)
    await enterScore('Host', 1, 50)

    const nextButton = screen.getByRole('button', { name: 'Next round' }) as HTMLButtonElement
    expect(nextButton.disabled).toBe(false)
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
    expect(screen.queryByText("You're offline — playing a local game on this device.")).toBeNull()
    expect(screen.getByText(`Room code: ${ROOM_CODE}`)).toBeTruthy()
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

    expect(screen.getByText("You're offline — playing a local game on this device.")).toBeTruthy()
    expect(
      screen.queryByText('Reconnecting… your scores are safe and will sync automatically.'),
    ).toBeNull()
  })
})
