import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, onMounted, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { render } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import App from './App.vue'
import { i18n } from '@/i18n'

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
})
