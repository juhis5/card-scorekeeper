import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, onMounted, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import App from './App.vue'
import { i18n } from '@/i18n'
import { useGameStore } from '@/stores/game'

vi.mock('@/composables/useServiceWorker', () => ({
  useServiceWorker: () => ({ needRefresh: ref(false), reload: vi.fn(), dismiss: vi.fn() }),
}))

describe('App', () => {
  it('starts a room view afresh for each room, so Play again never carries one game into the next', async () => {
    const roomMounts = vi.fn()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: { render: () => h('div') } },
        { path: '/stats', name: 'stats', component: { render: () => h('div') } },
        {
          path: '/room/:code',
          name: 'room',
          component: defineComponent({
            setup() {
              onMounted(roomMounts)
              return () => h('div')
            },
          }),
        },
      ],
    })
    await router.push('/room/ABCDE')
    render(App, { global: { plugins: [createPinia(), i18n, router] } })
    await flushPromises()

    await router.replace('/room/FGHJK')
    await flushPromises()

    expect(roomMounts).toHaveBeenCalledTimes(2)
  })

  it("shows the online room's code in the header while its page is open", async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const game = useGameStore()
    game.roomCode = '7K4RQ'
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: { render: () => h('div') } },
        { path: '/stats', name: 'stats', component: { render: () => h('div') } },
        { path: '/room/:code', name: 'room', component: { render: () => h('div') } },
      ],
    })
    await router.push('/room/7K4RQ')
    render(App, { global: { plugins: [pinia, i18n, router] } })
    await flushPromises()

    expect(screen.getByRole('button', { name: 'Copy room code 7K4RQ' })).toBeTruthy()

    await router.push('/stats')
    await flushPromises()
    expect(screen.queryByRole('button', { name: /Copy room code/ })).toBeNull()
  })
})
