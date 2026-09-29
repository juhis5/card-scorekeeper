import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fireEvent, render, screen } from '@testing-library/vue'
import AccountRow from './AccountRow.vue'
import { i18n, setLocale } from '@/i18n'
import { useAccountStore, type AccountStatus } from '@/stores/account'

beforeEach(() => {
  setActivePinia(createPinia())
  setLocale('en')
})

function renderRow(status: AccountStatus, { locked = false, email = 'juho@example.com' } = {}) {
  const account = useAccountStore()
  account.status = status
  account.email = status === 'signedIn' ? email : null
  const load = vi.spyOn(account, 'load').mockResolvedValue(undefined)
  const signIn = vi.spyOn(account, 'signIn').mockResolvedValue(undefined)
  const signOut = vi.spyOn(account, 'signOut').mockResolvedValue(undefined)
  const { container } = render(AccountRow, { props: { locked }, global: { plugins: [i18n] } })
  return { account, container, load, signIn, signOut }
}

describe('AccountRow', () => {
  it('loads the account when the menu opens, showing nothing until it knows', () => {
    const { container, load } = renderRow('loading')

    expect(load).toHaveBeenCalledTimes(1)
    expect(container.textContent).toBe('')
  })

  it('tries again after Firebase failed to load, and skips a known session', () => {
    expect(renderRow('unavailable').load).toHaveBeenCalledTimes(1)
    setActivePinia(createPinia())
    expect(renderRow('signedOut').load).not.toHaveBeenCalled()
  })

  it('signs in with Google from the row', async () => {
    const { signIn } = renderRow('signedOut')

    const row = screen.getByRole('button', { name: /Sign in with Google/ })
    expect(row.textContent).toContain('Keep your stats on all your devices')
    await fireEvent.click(row)

    expect(signIn).toHaveBeenCalledTimes(1)
  })

  it('shows who is signed in, and signs out', async () => {
    const { signOut } = renderRow('signedIn')

    expect(screen.getByText('Signed in with Google')).toBeTruthy()
    expect(screen.getByText('juho@example.com')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it("shows the account's claimed name under it", async () => {
    const { account } = renderRow('signedIn')
    account.claimStatus = 'claimed'
    account.claimedName = 'Juho'

    expect(await screen.findByText('Juho')).toBeTruthy()
    expect(screen.getByText('Claimed name')).toBeTruthy()
  })

  it('waits while a game is running, saying why', () => {
    renderRow('signedOut', { locked: true })
    const row = screen.getByRole('button', { name: /Sign in with Google/ }) as HTMLButtonElement

    expect(row.disabled).toBe(true)
    expect(row.textContent).toContain('Finish or leave the game first')
  })

  it('keeps a signed-in player from signing out mid-game', () => {
    renderRow('signedIn', { locked: true })

    expect((screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.getByText('Finish or leave the game first')).toBeTruthy()
  })

  it('disables the row while signing in', async () => {
    const { account } = renderRow('signedOut')
    account.isBusy = true
    await Promise.resolve()

    expect(
      (screen.getByRole('button', { name: /Sign in with Google/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('announces what happened in a live region', async () => {
    const { account, container } = renderRow('signedOut')
    const region = container.querySelector('[aria-live="polite"]')
    expect(region?.textContent).toBe('')

    account.notice = 'blocked'
    await Promise.resolve()

    expect(region?.textContent).toBe(
      'The sign-in window was blocked. Allow pop-ups for Rommi and try again.',
    )
  })
})
