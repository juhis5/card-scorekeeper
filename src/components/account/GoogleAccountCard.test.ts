import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { fireEvent, render, screen } from '@testing-library/vue'
import GoogleAccountCard from './GoogleAccountCard.vue'
import { i18n, setLocale } from '@/i18n'
import { useAccountStore, type AccountStatus } from '@/stores/account'

beforeEach(() => {
  setActivePinia(createPinia())
  setLocale('en')
})

function renderCard(status: AccountStatus, { locked = false } = {}) {
  const account = useAccountStore()
  account.status = status
  account.email = status === 'signedIn' ? 'juho@example.com' : null
  const load = vi.spyOn(account, 'load').mockResolvedValue(undefined)
  const signIn = vi.spyOn(account, 'signIn').mockResolvedValue(undefined)
  const signOut = vi.spyOn(account, 'signOut').mockResolvedValue(undefined)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/privacy', name: 'privacy', component: { render: () => null } },
    ],
  })
  render(GoogleAccountCard, { props: { locked }, global: { plugins: [i18n, router] } })
  return { account, load, signIn, signOut }
}

describe('GoogleAccountCard', () => {
  it('says it is loading until the session is known', () => {
    renderCard('loading')

    expect(screen.getByRole('status').textContent).toBe('Loading…')
  })

  it('offers another try when Firebase could not load', async () => {
    const { load } = renderCard('unavailable')

    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(load).toHaveBeenCalledTimes(1)
  })

  it("signs in with Google's button, and links to what is stored", async () => {
    const { signIn } = renderCard('signedOut')

    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))

    expect(signIn).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'What is stored' }).getAttribute('href')).toBe(
      '/privacy',
    )
  })

  it('shows who is signed in, and signs out', async () => {
    const { signOut } = renderCard('signedIn')

    expect(screen.getByText('juho@example.com')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('waits while a game runs, saying why', () => {
    renderCard('signedOut', { locked: true })

    const button = screen.getByRole('button', { name: 'Sign in with Google' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText(/Finish or leave the game first/)).toBeTruthy()
  })

  it('announces what signing in did, but leaves claim news to the name section', async () => {
    const { account } = renderCard('signedOut')
    account.lastAction = 'signIn'
    account.notice = 'blocked'
    expect(
      await screen.findByText(
        'The sign-in window was blocked. Allow pop-ups for Rommi and try again.',
      ),
    ).toBeTruthy()

    account.lastAction = 'claim'
    account.notice = 'taken'
    await Promise.resolve()
    expect(screen.queryByText('Someone already claimed that name.')).toBeNull()
  })
})
