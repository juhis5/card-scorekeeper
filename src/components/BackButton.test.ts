import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import { createMemoryHistory, createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import { flushPromises } from '@vue/test-utils'
import BackButton from './BackButton.vue'
import { i18n } from '@/i18n'

const blank = { template: '<div />' }

function makeRouter(history: RouterHistory) {
  return createRouter({
    history,
    routes: [
      { path: '/', name: 'home', component: blank },
      { path: '/stats', name: 'stats', component: blank },
      { path: '/room/:code', name: 'room', component: blank },
    ],
  })
}

async function popState(): Promise<void> {
  // router.back() is history.back(), which lands as an async popstate.
  await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }))
  await flushPromises()
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('BackButton', () => {
  it('goes Home when the page was opened directly, such as from a room link', async () => {
    const router = makeRouter(createMemoryHistory())
    await router.push('/room/7K4RQ')
    render(BackButton, { global: { plugins: [i18n, router] } })

    await fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('goes to the previous screen when there is one in this tab', async () => {
    const router = makeRouter(createWebHistory())
    await router.push('/stats')
    await router.push('/room/7K4RQ')
    render(BackButton, { global: { plugins: [i18n, router] } })

    const landed = popState()
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await landed

    expect(router.currentRoute.value.name).toBe('stats')
  })
})
