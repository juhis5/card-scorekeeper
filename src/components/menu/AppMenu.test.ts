import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import AppMenu from './AppMenu.vue'
import { i18n, setLocale } from '@/i18n'

// The service worker's virtual module only exists inside a Vite-built app.
const needRefresh = ref(false)
vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: () => ({ needRefresh, offlineReady: ref(false), updateServiceWorker: vi.fn() }),
}))

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { render: () => null } },
      { path: '/stats', name: 'stats', component: { render: () => null } },
      { path: '/rules', name: 'rules', component: { render: () => null } },
      { path: '/room/:code', name: 'room', component: { render: () => null } },
    ],
  })
}

async function renderMenu() {
  const router = makeRouter()
  await router.push('/room/ABCDE')
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
    expect(screen.getByRole('link', { name: 'Rules' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Language/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Theme/ })).toBeTruthy()
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
})
