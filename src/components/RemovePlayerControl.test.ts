import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import RemovePlayerControl from './RemovePlayerControl.vue'
import { i18n } from '@/i18n'

function renderControl() {
  return render(RemovePlayerControl, {
    props: { playerName: 'Alice' },
    global: { plugins: [i18n] },
  })
}

describe('RemovePlayerControl', () => {
  it('asks for confirmation before removing, with focus on the safe choice', async () => {
    const { emitted } = renderControl()

    await fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }))
    await flushPromises()

    expect(screen.getByText('Remove Alice and their scores from this game?')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep Alice' }))
    expect(emitted().remove).toBeUndefined()
  })

  it('removes once confirmed', async () => {
    const { emitted } = renderControl()

    await fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Alice' }))

    expect(emitted().remove).toHaveLength(1)
  })

  it('keeps the player and returns focus to the trigger when declined', async () => {
    const { emitted } = renderControl()

    await fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Keep Alice' }))
    await flushPromises()

    expect(emitted().remove).toBeUndefined()
    expect(screen.queryByText('Remove Alice and their scores from this game?')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Alice' }))
  })
})
