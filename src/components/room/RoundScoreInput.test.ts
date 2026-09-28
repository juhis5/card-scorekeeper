import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import RoundScoreInput from './RoundScoreInput.vue'

function renderInput() {
  return render(RoundScoreInput, { props: { id: 'score', label: 'Score' } })
}

describe('RoundScoreInput Enter', () => {
  it('commits on keydown', async () => {
    const { emitted } = renderInput()

    await fireEvent.keyDown(screen.getByLabelText('Score'), { key: 'Enter' })

    expect(emitted().commit).toHaveLength(1)
  })

  it('ignores a held key repeating, so the Enter-all sheet never saves the next field empty', async () => {
    const { emitted } = renderInput()

    await fireEvent.keyDown(screen.getByLabelText('Score'), { key: 'Enter', repeat: true })

    expect(emitted().commit).toBeUndefined()
  })

  it('ignores the Enter that confirms IME composition', async () => {
    const { emitted } = renderInput()

    await fireEvent.keyDown(screen.getByLabelText('Score'), { key: 'Enter', isComposing: true })

    expect(emitted().commit).toBeUndefined()
  })
})
