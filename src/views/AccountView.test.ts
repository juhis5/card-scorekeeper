import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { render, screen } from '@testing-library/vue'
import AccountView from './AccountView.vue'
import { i18n, setLocale } from '@/i18n'
import { LocalGameRepository } from '@/lib/data/local-repository'
import { useAccountStore, type AccountStatus } from '@/stores/account'
import { useGameStore } from '@/stores/game'

beforeEach(() => {
  setActivePinia(createPinia())
  setLocale('en')
})

function renderView(status: AccountStatus) {
  const account = useAccountStore()
  account.status = status
  const load = vi.spyOn(account, 'load').mockResolvedValue(undefined)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/privacy', name: 'privacy', component: { render: () => null } },
    ],
  })
  render(AccountView, { global: { plugins: [i18n, router] } })
  return { load }
}

describe('AccountView', () => {
  it('loads the account as it opens, with the page heading and both sections', () => {
    const { load } = renderView('loading')

    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Google account' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Your name' })).toBeTruthy()
  })

  it('tries again after a failed load, and not once the session is known', () => {
    expect(renderView('unavailable').load).toHaveBeenCalledTimes(1)
    setActivePinia(createPinia())
    expect(renderView('signedOut').load).not.toHaveBeenCalled()
  })

  it('holds sign-in while a game runs on this device', async () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    }
    await useGameStore().start(new LocalGameRepository({ storage }), {
      hostDeviceUuid: 'd',
      hostDisplayName: 'Juho',
    })

    renderView('signedOut')

    const signIn = screen.getByRole('button', { name: 'Sign in with Google' }) as HTMLButtonElement
    expect(signIn.disabled).toBe(true)
  })
})
