import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import EnterAllScoresSheet from './EnterAllScoresSheet.vue'
import { i18n, setLocale } from '@/i18n'
import type { Player } from '@/lib/types'

const JANI: Player = { id: 'jani', name: 'Jani', totalScore: 0 }
const RIPA: Player = { id: 'ripa', name: 'Ripa', totalScore: 0, isGuest: true }
const AINO: Player = { id: 'aino', name: 'Aino', totalScore: 0 }

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
})

async function renderSheet(players: Player[], save = vi.fn().mockResolvedValue(true)) {
  const onUpdateOpen = vi.fn()
  const result = render(EnterAllScoresSheet, {
    props: { open: true, players, round: 1, save, 'onUpdate:open': onUpdateOpen },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return { ...result, save, onUpdateOpen }
}

function field(): HTMLInputElement {
  return screen.getByRole('spinbutton') as HTMLInputElement
}

describe('EnterAllScoresSheet', () => {
  it('starts with the first player missing a score, says where it is, and focuses the field', async () => {
    await renderSheet([JANI, RIPA, AINO])

    expect(screen.getByRole('dialog', { name: 'Enter points · 1/3' })).toBeTruthy()
    expect(screen.getByLabelText("Jani's round 1 score")).toBe(document.activeElement)
    expect(screen.getByText('Next: Ripa')).toBeTruthy()
  })

  it('saves with ✓ and moves on in the same field, so the keyboard stays up', async () => {
    const { save, rerender } = await renderSheet([JANI, RIPA, AINO])
    const input = field()

    await fireEvent.update(input, '15')
    await fireEvent.click(screen.getByRole('button', { name: 'Save and next' }))
    await flushPromises()
    await rerender({ players: [RIPA, AINO] })
    await flushPromises()

    expect(save).toHaveBeenCalledWith('jani', 1, 15)
    expect(screen.getByRole('dialog', { name: 'Enter points · 2/3' })).toBeTruthy()
    expect(screen.getByLabelText("Ripa's round 1 score")).toBe(input)
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
  })

  it('skips with → without saving', async () => {
    const { save } = await renderSheet([JANI, RIPA])

    await fireEvent.click(screen.getByRole('button', { name: 'Skip Jani' }))
    await flushPromises()

    expect(save).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Ripa's round 1 score")).toBeTruthy()
  })

  it('drops a player who enters their own score meanwhile', async () => {
    const { rerender } = await renderSheet([JANI, RIPA, AINO])

    await rerender({ players: [JANI, AINO] })

    expect(screen.getByText('Next: Aino')).toBeTruthy()
  })

  it('closes when nobody is left', async () => {
    const { rerender, onUpdateOpen } = await renderSheet([JANI])

    await fireEvent.update(field(), '10')
    await fireEvent.click(screen.getByRole('button', { name: 'Save and next' }))
    await flushPromises()
    await rerender({ players: [] })
    await flushPromises()

    expect(onUpdateOpen).toHaveBeenCalledWith(false)
  })

  it('stays on the player and says why when the score is wrong or does not save', async () => {
    const { save } = await renderSheet([JANI, RIPA], vi.fn().mockResolvedValue(false))

    await fireEvent.update(field(), '12')
    await fireEvent.click(screen.getByRole('button', { name: 'Save and next' }))
    expect(screen.getByRole('alert').textContent).toContain('multiple of 5')
    expect(save).not.toHaveBeenCalled()

    await fireEvent.update(field(), '10')
    await fireEvent.click(screen.getByRole('button', { name: 'Save and next' }))
    await flushPromises()
    expect(screen.getByRole('alert').textContent).toContain("Couldn't save Jani's score")
    expect(screen.getByLabelText("Jani's round 1 score")).toBeTruthy()
  })
})
