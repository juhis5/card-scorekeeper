import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { render, screen, fireEvent } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import GameSetup from './GameSetup.vue'
import { useGameStore } from '@/stores/game'
import { i18n } from '@/i18n'

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

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('GameSetup validation', () => {
  it('shows inline errors and does not start when host name and other players are missing', async () => {
    renderGameSetup()

    await fireEvent.click(screen.getByRole('button', { name: 'Start game' }))

    expect(screen.getByText('Enter your name to continue.')).toBeTruthy()
    expect(screen.getByText('Add at least one other player.')).toBeTruthy()
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

describe('GameSetup starting a game', () => {
  it('starts a local game with the entered players and navigates to the room', async () => {
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
