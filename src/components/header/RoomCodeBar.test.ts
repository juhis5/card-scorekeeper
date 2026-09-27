import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import RoomCodeBar from './RoomCodeBar.vue'
import InviteSheet from './InviteSheet.vue'
import { i18n } from '@/i18n'

const writeText = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
})

describe('RoomCodeBar', () => {
  it('shows the code as a room code, and copies it in one tap', async () => {
    render(RoomCodeBar, { props: { code: '7K4RQ' }, global: { plugins: [i18n] } })

    expect(screen.getByText('7K4RQ').parentElement?.textContent).toContain('Room')
    await fireEvent.click(screen.getByRole('button', { name: 'Copy room code 7K4RQ' }))
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('7K4RQ')
    expect(screen.getByRole('status').textContent).toBe('Room code copied')
  })

  it('opens the invite sheet from Invite', async () => {
    render(RoomCodeBar, { props: { code: '7K4RQ' }, global: { plugins: [i18n] } })

    await fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    await flushPromises()

    expect(screen.getByRole('dialog', { name: 'Invite players' })).toBeTruthy()
  })
})

describe('InviteSheet', () => {
  async function renderSheet() {
    render(InviteSheet, { props: { code: '7K4RQ', open: true }, global: { plugins: [i18n] } })
    await flushPromises()
  }

  it('shows a QR code, the code, and copies the code', async () => {
    await renderSheet()

    expect(
      await screen.findByRole('img', { name: 'QR code for the link to join this room' }),
    ).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('7K4RQ')
    expect(screen.getByText('Room code copied')).toBeTruthy()
  })

  it("shares the join link through the phone's share sheet", async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    await renderSheet()

    await fireEvent.click(screen.getByRole('button', { name: 'Share link' }))
    await flushPromises()

    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${window.location.origin}/join/7K4RQ` }),
    )
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the link where there is no share sheet', async () => {
    await renderSheet()

    await fireEvent.click(screen.getByRole('button', { name: 'Share link' }))
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/7K4RQ`)
    expect(screen.getByText('Link copied')).toBeTruthy()
  })

  it('does nothing more when the player closes the share sheet', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError'))
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    await renderSheet()

    await fireEvent.click(screen.getByRole('button', { name: 'Share link' }))
    await flushPromises()

    expect(writeText).not.toHaveBeenCalled()
  })
})
