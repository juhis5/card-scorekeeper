import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import HomeView from './HomeView.vue'
import { i18n } from '@/i18n'
import { rememberRoom } from '@/lib/last-room'
import { LocalGameRepository } from '@/lib/local-repository'

const blank = { template: '<div />' }

/** The forms are stubbed unless a test is about them; nothing here submits, so no network. */
async function renderHome({ withForms = false } = {}) {
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
    global: {
      plugins: [i18n, router],
      stubs: withForms ? {} : { GameSetup: true, JoinGame: true },
    },
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

describe('HomeView, joining or starting', () => {
  it('opens on Join, with the name and the room code', async () => {
    await renderHome({ withForms: true })

    expect(screen.getByRole('button', { name: 'Join', pressed: true })).toBeTruthy()
    expect(screen.getByLabelText('Room code')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join game' })).toBeTruthy()
  })

  it('keeps the typed name when switching to New game, which needs no code', async () => {
    await renderHome({ withForms: true })

    await fireEvent.update(screen.getByLabelText('Your name'), 'Juho')
    await fireEvent.click(screen.getByRole('button', { name: 'New game' }))

    expect(screen.getByRole('button', { name: 'New game', pressed: true })).toBeTruthy()
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Juho')
    expect(screen.queryByLabelText('Room code')).toBeNull()
    expect(screen.getByRole('button', { name: 'Start game' })).toBeTruthy()
  })
})
