import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import PlayerNameCard from './PlayerNameCard.vue'
import { i18n, setLocale } from '@/i18n'
import { useAccountStore, type AccountStatus, type ClaimStatus } from '@/stores/account'
import { useIdentityStore } from '@/stores/identity'

beforeEach(() => {
  setActivePinia(createPinia())
  setLocale('en')
})

interface Setup {
  status?: AccountStatus
  claimStatus?: ClaimStatus
  claimedName?: string | null
  name?: string
  /** What the store's claim does: moves the claim by default. */
  claimSucceeds?: boolean
}

function renderCard({
  status = 'signedIn',
  claimStatus = 'unclaimed',
  claimedName = null,
  name = 'Juho',
  claimSucceeds = true,
}: Setup = {}) {
  const account = useAccountStore()
  account.status = status
  account.claimStatus = claimStatus
  account.claimedName = claimedName
  const identity = useIdentityStore()
  identity.setDisplayName(name)
  const claim = vi.spyOn(account, 'claim').mockImplementation(async (claimed: string) => {
    account.lastAction = 'claim'
    if (!claimSucceeds) {
      account.notice = 'taken'
      return
    }
    account.claimStatus = 'claimed'
    account.claimedName = claimed.trim()
    account.notice = 'claimed'
  })
  render(PlayerNameCard, { global: { plugins: [i18n] } })
  return { account, identity, claim }
}

async function rename(name: string): Promise<void> {
  await fireEvent.update(screen.getByLabelText('Name in games'), name)
  await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await flushPromises()
}

describe('PlayerNameCard', () => {
  it('saves a new name for this device, cleaned, and says so', async () => {
    const { identity, claim } = renderCard({ status: 'signedOut' })

    await rename('  Jussi  ')

    expect(identity.displayName).toBe('Jussi')
    expect(claim).not.toHaveBeenCalled()
    expect(screen.getByText('Name saved.')).toBeTruthy()
  })

  it('asks for a name rather than saving an empty one', async () => {
    const { identity } = renderCard({ status: 'signedOut' })

    await rename('   ')

    expect(identity.displayName).toBe('Juho')
    expect(screen.getByText('Enter a name.')).toBeTruthy()
    expect(screen.getByLabelText('Name in games').getAttribute('aria-invalid')).toBe('true')
  })

  it('has nothing to save until the name changes', () => {
    renderCard()

    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('points a signed-out player to signing in to claim the name', () => {
    renderCard({ status: 'signedOut' })

    expect(screen.getByText(/Sign in with Google to claim your name/)).toBeTruthy()
  })

  it('claims the saved name for a signed-in player', async () => {
    const { claim } = renderCard()

    expect(screen.getByText('Claim it and nobody else can join a game as Juho.')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Claim Juho' }))
    await flushPromises()

    expect(claim).toHaveBeenCalledWith('Juho')
    expect(screen.getByText('The name is yours now.')).toBeTruthy()
  })

  it('moves the claim with the name, after a confirm that the old name frees up', async () => {
    const { identity, claim } = renderCard({ claimStatus: 'claimed', claimedName: 'Juho' })
    expect(screen.getByText('Claimed for you')).toBeTruthy()

    await rename('Jussi')
    const dialog = await screen.findByRole('alertdialog', { name: 'Move your claim to Jussi?' })
    expect(dialog.textContent).toContain('Juho becomes free')
    expect(identity.displayName).toBe('Juho')
    await fireEvent.click(screen.getByRole('button', { name: 'Move claim' }))
    await flushPromises()

    expect(claim).toHaveBeenCalledWith('Jussi')
    expect(identity.displayName).toBe('Jussi')
  })

  it('keeps the old name when the claim cannot move, and says why', async () => {
    const { identity } = renderCard({
      claimStatus: 'claimed',
      claimedName: 'Juho',
      claimSucceeds: false,
    })

    await rename('Ripa')
    await fireEvent.click(await screen.findByRole('button', { name: 'Move claim' }))
    await flushPromises()

    expect(identity.displayName).toBe('Juho')
    expect(screen.getByText('Someone already claimed that name.')).toBeTruthy()
  })

  it('changes only the spelling of a claimed name without moving the claim', async () => {
    const { identity, claim } = renderCard({ claimStatus: 'claimed', claimedName: 'Juho' })

    await rename('JUHO')

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(claim).not.toHaveBeenCalled()
    expect(identity.displayName).toBe('JUHO')
  })

  it('cancels a move, keeping the name and the claim', async () => {
    const { identity, claim } = renderCard({ claimStatus: 'claimed', claimedName: 'Juho' })

    await rename('Jussi')
    await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await flushPromises()

    expect(claim).not.toHaveBeenCalled()
    expect(identity.displayName).toBe('Juho')
  })
})
