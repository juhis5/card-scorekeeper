import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import RoomView from './RoomView.vue'
import { useGameStore } from '@/stores/game'
import { LocalGameRepository } from '@/lib/local-repository'
import type { KeyValueStorage } from '@/lib/local-repository'
import { i18n } from '@/i18n'

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
