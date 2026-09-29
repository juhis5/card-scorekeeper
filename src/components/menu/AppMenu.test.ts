import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import AppMenu from './AppMenu.vue'
import { i18n, setLocale } from '@/i18n'
import { LocalGameRepository } from '@/lib/data/local-repository'
import { useGameStore } from '@/stores/game'

// The service worker's virtual module only exists inside a Vite-built app.
const needRefresh = ref(false)
vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: () => ({ needRefresh, offlineReady: ref(false), updateServiceWorker: vi.fn() }),
}))

// Firebase restores an anonymous session: the menu offers Google sign-in.
vi.mock('@/lib/data/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: null, authStateReady: () => Promise.resolve() }),
  getDb: () => ({}),
}))

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { render: () => null } },
      { path: '/stats', name: 'stats', component: { render: () => null } },
      { path: '/highscores', name: 'highscores', component: { render: () => null } },
      { path: '/rules', name: 'rules', component: { render: () => null } },
      { path: '/privacy', name: 'privacy', component: { render: () => null } },
      { path: '/room/:code', name: 'room', component: { render: () => null } },
    ],
  })
}

async function renderMenu(path = '/room/ABCDE') {
  const router = makeRouter()
  await router.push(path)
  render(AppMenu, { global: { plugins: [i18n, router] } })
  return router
}

async function openMenu(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  setLocale('en')
})

describe('AppMenu', () => {
  it("opens a panel with the app's name, the pages and the settings", async () => {
    await renderMenu()

    await openMenu()

    const panel = screen.getByRole('dialog', { name: 'Rommi' })
    expect(panel).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Stats' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Highscores' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Rules' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Privacy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Language/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Theme/ })).toBeTruthy()
    expect(await screen.findByRole('button', { name: /Sign in with Google/ })).toBeTruthy()
  })

  it('offers the waiting new version as a row, only while there is one', async () => {
    await renderMenu()
    await openMenu()
    expect(screen.queryByRole('button', { name: /Update the app/ })).toBeNull()

    needRefresh.value = true
    await flushPromises()

    expect(screen.getByRole('button', { name: /Update the app/ })).toBeTruthy()
    needRefresh.value = false
  })

  it('goes to the page and closes when a link is followed', async () => {
    const router = await renderMenu()
    await openMenu()

    await fireEvent.click(screen.getByRole('link', { name: 'Stats' }))
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('stats')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('switches the language from inside the panel', async () => {
    await renderMenu()
    await openMenu()

    await fireEvent.click(screen.getByRole('button', { name: /^Language/ }))

    expect(screen.getByRole('link', { name: 'Tilastot' })).toBeTruthy()
  })

  it('closes with its close button', async () => {
    await renderMenu()
    await openMenu()

    await fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    await flushPromises()

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('holds account changes while a game runs, even from Home, where it offers no exit', async () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    }
    await useGameStore().start(new LocalGameRepository({ storage }), {
      hostDeviceUuid: 'd',
      hostDisplayName: 'Juho',
    })
    await renderMenu('/')
    await openMenu()

    const signIn = await screen.findByRole('button', { name: /Sign in with Google/ })
    expect((signIn as HTMLButtonElement).disabled).toBe(true)
    expect(signIn.textContent).toContain('Finish or leave the game first')
    expect(screen.queryByRole('list', { name: 'This game' })).toBeNull()
  })
})
