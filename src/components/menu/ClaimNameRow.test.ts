import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import ClaimNameRow from './ClaimNameRow.vue'
import { i18n, setLocale } from '@/i18n'
import { useAccountStore, type ClaimStatus } from '@/stores/account'
import { useIdentityStore } from '@/stores/identity'

beforeEach(() => {
  setActivePinia(createPinia())
  setLocale('en')
})

function renderRow(
  claimStatus: ClaimStatus,
  { name = 'Juho', claimedName = null as string | null, locked = false } = {},
) {
  const account = useAccountStore()
  account.status = 'signedIn'
  account.claimStatus = claimStatus
  account.claimedName = claimedName
  useIdentityStore().setDisplayName(name)
  const claim = vi.spyOn(account, 'claim').mockResolvedValue(undefined)
  const { container } = render(ClaimNameRow, { props: { locked }, global: { plugins: [i18n] } })
  return { claim, container }
}

describe('ClaimNameRow', () => {
  it('shows the claimed name with its badge', () => {
    renderRow('claimed', { claimedName: 'Juho' })

    expect(screen.getByText('Your name')).toBeTruthy()
    expect(screen.getByText('Juho')).toBeTruthy()
    expect(screen.getByText('Claimed name')).toBeTruthy()
  })

  it('claims the player name after a confirm that says it is for good', async () => {
    const { claim } = renderRow('unclaimed', { name: ' Juho ' })

    expect(screen.getByText('Claim it and nobody else can join a game as Juho.')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Claim the name Juho' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Claim Juho for good?' })
    expect(dialog.textContent).toContain("the app's owner can release it")
    await fireEvent.click(screen.getByRole('button', { name: 'Claim' }))
    await flushPromises()

    expect(claim).toHaveBeenCalledWith('Juho')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('cancels without claiming', async () => {
    const { claim } = renderRow('unclaimed')

    await fireEvent.click(screen.getByRole('button', { name: 'Claim the name Juho' }))
    await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await flushPromises()

    expect(claim).not.toHaveBeenCalled()
  })

  it('asks for a name first when the player has none', () => {
    renderRow('unclaimed', { name: '' })

    expect(screen.getByText('Set your name on the home screen to claim it.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('waits while a game is running', () => {
    renderRow('unclaimed', { locked: true })

    expect(
      (screen.getByRole('button', { name: 'Claim the name Juho' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('shows nothing until the claim is known', () => {
    const { container } = renderRow('unknown')

    expect(container.textContent).toBe('')
  })
})
