import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { render, screen } from '@testing-library/vue'
import InviteNotice from './InviteNotice.vue'
import { i18n, setLocale } from '@/i18n'
import { useAccountStore } from '@/stores/account'
import { useInvitesStore } from '@/stores/invites'

beforeEach(() => {
  setActivePinia(createPinia())
  setLocale('en')
  vi.restoreAllMocks()
})

function renderNotice({
  email = 'juho@example.com' as string | null,
  pending = 0,
  online = true,
} = {}) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
  useAccountStore().email = email
  const invites = useInvitesStore()
  const loadPendingCount = vi.spyOn(invites, 'loadPendingCount').mockImplementation(async () => {
    invites.pendingCount = pending
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/account', name: 'account', component: { render: () => null } },
    ],
  })
  const rendered = render(InviteNotice, { global: { plugins: [i18n, router] } })
  return { loadPendingCount, ...rendered }
}

describe('InviteNotice', () => {
  it('points a signed-in player to the invites waiting for them', async () => {
    renderNotice({ pending: 2 })

    expect(await screen.findByText('You have 2 game invites to answer.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Answer' }).getAttribute('href')).toBe('/account')
  })

  it('says one invite in the singular', async () => {
    renderNotice({ pending: 1 })

    expect(await screen.findByText('You have 1 game invite to answer.')).toBeTruthy()
  })

  it('shows nothing with none waiting', async () => {
    const { container } = renderNotice({ pending: 0 })
    await Promise.resolve()

    expect(container.textContent).toBe('')
  })

  it('never looks when this device is not signed in, or offline', () => {
    expect(renderNotice({ email: null }).loadPendingCount).not.toHaveBeenCalled()
    setActivePinia(createPinia())
    expect(renderNotice({ online: false }).loadPendingCount).not.toHaveBeenCalled()
  })
})
