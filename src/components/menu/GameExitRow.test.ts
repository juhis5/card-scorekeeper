import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import GameExitRow from './GameExitRow.vue'
import { i18n, setLocale } from '@/i18n'
import type { GameRepository } from '@/lib/data/repository'
import type { GameState } from '@/lib/game/types'
import { TimeoutError } from '@/lib/platform/timeout'
import { useGameStore } from '@/stores/game'

function onlineRoom(): GameRepository & { abandonGame: ReturnType<typeof vi.fn> } {
  const state: GameState = {
    status: 'playing',
    currentRound: 2,
    players: [{ id: 'host', name: 'Juho', totalScore: 0 }],
    roundScores: [],
  }
  return {
    createGame: vi
      .fn()
      .mockResolvedValue({ gameId: '7K4RQ', roomCode: '7K4RQ', hostPlayerId: 'host' }),
    addPlayer: vi.fn().mockResolvedValue('alice'),
    addGuest: vi.fn(),
    subscribe: (onChange) => {
      onChange(state)
      return () => undefined
    },
    setRoundScore: vi.fn(),
    removePlayer: vi.fn(),
    advanceRound: vi.fn(),
    finishGame: vi.fn(),
    abandonGame: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn(),
  }
}

async function renderRow() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { render: () => null } },
      { path: '/room/:code', name: 'room', component: { render: () => null } },
    ],
  })
  await router.push('/room/7K4RQ')
  const view = render(GameExitRow, { global: { plugins: [i18n, router] } })
  return { router, ...view }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  setLocale('en')
})

describe('GameExitRow', () => {
  it('lets the host end the game for everyone after confirming, then goes home', async () => {
    const room = onlineRoom()
    await useGameStore().start(room, { hostDeviceUuid: 'd', hostDisplayName: 'Juho' })
    const { router, emitted } = await renderRow()

    await fireEvent.click(screen.getByRole('button', { name: /^End the game/ }))
    expect(screen.getByRole('alertdialog', { name: 'End the game for everyone?' })).toBeTruthy()
    expect(room.abandonGame).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: 'End the game' }))
    await flushPromises()

    expect(room.abandonGame).toHaveBeenCalledTimes(1)
    expect(emitted().done).toHaveLength(1)
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('keeps the dialog open and says so when ending does not go through', async () => {
    const room = onlineRoom()
    room.abandonGame.mockRejectedValue(new Error('offline'))
    await useGameStore().start(room, { hostDeviceUuid: 'd', hostDisplayName: 'Juho' })
    const { router } = await renderRow()

    await fireEvent.click(screen.getByRole('button', { name: /^End the game/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'End the game' }))
    await flushPromises()

    expect(screen.getByRole('alert').textContent).toContain("Couldn't end the game")
    expect(router.currentRoute.value.name).toBe('room')
  })

  it('says a timed-out end is still on its way rather than that it failed', async () => {
    const room = onlineRoom()
    room.abandonGame.mockRejectedValue(new TimeoutError(10_000))
    await useGameStore().start(room, { hostDeviceUuid: 'd', hostDisplayName: 'Juho' })
    await renderRow()

    await fireEvent.click(screen.getByRole('button', { name: /^End the game/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'End the game' }))
    await flushPromises()

    const alert = screen.getByRole('alert').textContent
    expect(alert).toContain('ends for everyone as soon as this phone is back online')
    expect(alert).not.toContain("Couldn't end the game")
  })

  it('lets a player leave without ending it for the others', async () => {
    const room = onlineRoom()
    await useGameStore().join(room, '7K4RQ', { name: 'Alice', deviceUuid: 'd' })
    const { router } = await renderRow()

    await fireEvent.click(screen.getByRole('button', { name: /^Leave the game/ }))
    expect(screen.getByRole('alertdialog', { name: 'Leave the game?' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await flushPromises()

    expect(room.abandonGame).not.toHaveBeenCalled()
    expect(useGameStore().roomCode).toBeNull()
    expect(router.currentRoute.value.name).toBe('home')
  })
})
