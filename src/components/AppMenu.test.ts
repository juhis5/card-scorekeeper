import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import AppMenu from './AppMenu.vue'
import { i18n, setLocale } from '@/i18n'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { render: () => null } },
      { path: '/stats', name: 'stats', component: { render: () => null } },
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

    const panel = screen.getByRole('dialog', { name: 'Rommi Scorekeeper' })
    expect(panel).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Stats' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /switch language/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dark mode' })).toBeTruthy()
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

    await fireEvent.click(screen.getByRole('button', { name: /switch language/ }))

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
