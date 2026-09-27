import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import HomeView from './HomeView.vue'
import { i18n } from '@/i18n'
import { rememberRoom } from '@/lib/last-room'
import { LocalGameRepository } from '@/lib/local-repository'

const blank = { template: '<div />' }

async function renderHome() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: blank },
      { path: '/room/:code', name: 'room', component: blank },
      { path: '/stats', name: 'stats', component: blank },
    ],
  })
  await router.push('/')
  render(HomeView, {
    global: { plugins: [i18n, router], stubs: { GameSetup: true, JoinGame: true } },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('HomeView, a game in progress', () => {
  it('offers to continue the online room this device was last in', async () => {
    rememberRoom('7K4RQ')

    await renderHome()

    expect(screen.getByRole('heading', { name: 'Game in progress' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Continue room 7K4RQ' }).getAttribute('href')).toBe(
      '/room/7K4RQ',
    )
  })

  it('offers to continue an unfinished game on this device', async () => {
    await new LocalGameRepository().createGame({
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Host',
    })

    await renderHome()

    expect(
      screen.getByRole('link', { name: 'Continue the game on this device' }).getAttribute('href'),
    ).toBe('/room/local')
  })

  it('offers nothing when no game is in progress', async () => {
    await renderHome()

    expect(screen.queryByRole('heading', { name: 'Game in progress' })).toBeNull()
  })
})
