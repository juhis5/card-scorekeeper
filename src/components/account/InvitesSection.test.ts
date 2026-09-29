import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import InvitesSection from './InvitesSection.vue'
import { i18n, setLocale } from '@/i18n'
import { useInvitesStore, type InviteView, type InvitesStatus } from '@/stores/invites'

beforeEach(() => {
  setActivePinia(createPinia())
  setLocale('en')
})

function view(id: string, overrides: Partial<InviteView> = {}): InviteView {
  return {
    id,
    gameId: id.split('_')[0] ?? id,
    guestId: 'guest-1',
    hostName: 'Ripa',
    name: 'Juho',
    status: 'pending',
    createdAt: Date.UTC(2026, 8, 29, 18),
    game: 'running',
    ...overrides,
  }
}

function renderSection(status: InvitesStatus, invites: InviteView[] = []) {
  const store = useInvitesStore()
  const start = vi.spyOn(store, 'start').mockImplementation(async () => {
    store.status = status
    store.invites = invites
  })
  const stop = vi.spyOn(store, 'stop').mockImplementation(() => undefined)
  const accept = vi.spyOn(store, 'accept').mockResolvedValue(undefined)
  const decline = vi.spyOn(store, 'decline').mockResolvedValue(undefined)
  const acceptAll = vi.spyOn(store, 'acceptAll').mockResolvedValue(undefined)
  const rendered = render(InvitesSection, { global: { plugins: [i18n] } })
  return { store, start, stop, accept, decline, acceptAll, ...rendered }
}

describe('InvitesSection', () => {
  it('follows the invites while shown', async () => {
    const { start, stop, unmount } = renderSection('ready')
    expect(start).toHaveBeenCalledTimes(1)

    unmount()

    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('says it is loading, failed or has nothing open', async () => {
    renderSection('loading')
    expect(await screen.findByText('Loading…')).toBeTruthy()

    setActivePinia(createPinia())
    renderSection('error')
    expect(
      await screen.findByText("Couldn't load your invites. Check your connection."),
    ).toBeTruthy()

    setActivePinia(createPinia())
    renderSection('ready', [])
    expect(await screen.findByText('No open invites.')).toBeTruthy()
  })

  it('lists each invite with who, when and how its game stands, to accept or decline', async () => {
    const pending = view('PLAYS_guest-1')
    const { accept, decline } = renderSection('ready', [pending])

    const item = await screen.findByRole('listitem')
    expect(item.textContent).toContain('Ripa added you as Juho')
    expect(item.textContent).toContain('The game is still on')
    expect(item.textContent).toMatch(/2026/)
    await fireEvent.click(within(item).getByRole('button', { name: 'Accept' }))
    await fireEvent.click(within(item).getByRole('button', { name: 'Decline' }))

    expect(accept).toHaveBeenCalledWith(pending)
    expect(decline).toHaveBeenCalledWith(pending)
  })

  it('lets an accepted invite be cancelled, and one whose game ended be removed', async () => {
    const accepted = view('PLAYS_guest-1', { status: 'accepted' })
    const ended = view('ENDED_guest-2', { game: 'ended' })
    const { decline } = renderSection('ready', [accepted, ended])

    const [acceptedItem, endedItem] = await screen.findAllByRole('listitem')
    expect(acceptedItem?.textContent).toContain('goes into your stats when the game finishes')
    expect(endedItem?.textContent).toContain('The game ended without a result')
    await fireEvent.click(
      within(acceptedItem as HTMLElement).getByRole('button', { name: 'Cancel' }),
    )
    await fireEvent.click(within(endedItem as HTMLElement).getByRole('button', { name: 'Remove' }))

    expect(decline.mock.calls.map(([invite]) => invite.id)).toEqual([
      'PLAYS_guest-1',
      'ENDED_guest-2',
    ])
  })

  it('shows no game line before the game is read, nor a date before the server stamps it', async () => {
    renderSection('ready', [view('PLAYS_guest-1', { game: null, createdAt: null })])

    const item = await screen.findByRole('listitem')
    expect(item.textContent).not.toContain('The game')
    expect(item.textContent).not.toMatch(/2026/)
  })

  it('offers to accept all when several can count, and announces the outcome', async () => {
    const { store, acceptAll } = renderSection('ready', [
      view('FINIS_guest-1', { game: 'finished' }),
      view('PLAYS_guest-2'),
      view('ENDED_guest-3', { game: 'ended' }),
    ])

    await fireEvent.click(await screen.findByRole('button', { name: 'Accept all (2)' }))
    expect(acceptAll).toHaveBeenCalledTimes(1)

    store.notice = 'counted'
    expect(await screen.findByText('Added to your stats.')).toBeTruthy()
  })

  it('holds every button while an answer is on its way', async () => {
    const { store } = renderSection('ready', [view('PLAYS_guest-1')])
    await screen.findByRole('listitem')

    store.busyInviteId = 'PLAYS_guest-1'
    await Promise.resolve()

    const accept = screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    expect(accept.getAttribute('aria-busy')).toBe('true')
  })
})
