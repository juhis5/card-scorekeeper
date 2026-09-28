import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import ScoreCard from './ScoreCard.vue'
import { i18n } from '@/i18n'
import type { Player } from '@/lib/game/types'

const countCardsMock = vi.fn()

const isPendingMock = ref(false)

vi.mock('@/composables/usePhotoCount', () => ({
  usePhotoCount: () => ({
    isPending: isPendingMock,
    countCards: async (roomCode: string, file: Blob) => {
      isPendingMock.value = true
      try {
        return await countCardsMock(roomCode, file)
      } finally {
        isPendingMock.value = false
      }
    },
  }),
}))

const ALICE: Player = { id: 'player-a', name: 'Alice', totalScore: 0 }

function renderCard(props: Partial<InstanceType<typeof ScoreCard>['$props']> = {}) {
  return render(ScoreCard, {
    props: { player: ALICE, round: 1, ...props },
    global: { plugins: [i18n] },
  })
}

async function expandCard(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: /^(enter|edit) .+'s score/i }))
}

function scoreInput(): HTMLInputElement {
  return screen.getByLabelText("Alice's round 1 score") as HTMLInputElement
}

/** A press on a control in the card while the input has focus: pointerdown, blur, click. iOS
 * Safari doesn't focus a tapped button, so the blur carries no relatedTarget. */
async function pressInsideCard(control: HTMLElement): Promise<void> {
  await fireEvent.pointerDown(control)
  scoreInput().blur()
  await fireEvent.click(control)
}

/** Chromium blurs a focused input as it's removed, so collapsing fires a blur: dispatch it right
 * after the key event, before Vue patches the DOM. */
async function keyThenRemovalBlur(sendKey: () => Promise<unknown>): Promise<void> {
  const input = scoreInput()
  const pending = sendKey()
  input.dispatchEvent(new FocusEvent('blur'))
  await pending
}

async function save(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

function headerButton(): HTMLElement {
  return screen.getByRole('button', { name: /^(enter|edit) alice's score/i })
}

async function selectPhoto(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'Snap cards' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Take or choose a photo' }))
  const fileInput = screen.getByTestId('photo-count-file') as HTMLInputElement
  const file = new File(['fake-bytes'], 'hand.jpg', { type: 'image/jpeg' })
  await fireEvent.change(fileInput, { target: { files: [file] } })
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  isPendingMock.value = false
})

describe('ScoreCard', () => {
  it('shows the player name in the collapsed state', () => {
    renderCard()

    expect(screen.getByText('Alice')).toBeTruthy()
  })

  it('hides the input when collapsed', () => {
    renderCard()

    expect(screen.queryByLabelText("Alice's round 1 score")).toBeNull()
  })

  it('expands to show the input when the card is clicked', async () => {
    renderCard()

    await expandCard()

    expect(screen.getByLabelText("Alice's round 1 score")).toBeTruthy()
  })

  it('commits a valid score and collapses', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.update(screen.getByLabelText("Alice's round 1 score"), '10')
    await save()
    await flushPromises()

    expect(emitted().commit).toEqual([[ALICE.id, 1, 10]])
    expect(screen.queryByLabelText("Alice's round 1 score")).toBeNull()
  })

  it('collapses on Escape key', async () => {
    const { container } = renderCard()

    await expandCard()
    expect(screen.getByLabelText("Alice's round 1 score")).toBeTruthy()

    await fireEvent.keyDown(container.firstElementChild!, { key: 'Escape' })
    expect(screen.queryByLabelText("Alice's round 1 score")).toBeNull()
  })

  it('rejects a non-multiple-of-5 score with an error', async () => {
    renderCard()

    await expandCard()
    await fireEvent.update(screen.getByLabelText("Alice's round 1 score"), '9')
    await save()

    expect(screen.getByText('Enter a multiple of 5 from 0 to 1,000.')).toBeTruthy()
  })

  it('rejects a score over the 1000-point cap instead of saving it', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.update(screen.getByLabelText("Alice's round 1 score"), '1005')
    await save()

    expect(emitted().commit).toBeUndefined()
    expect(screen.getByText('Enter a multiple of 5 from 0 to 1,000.')).toBeTruthy()
  })

  it('clears the error when a valid score is entered', async () => {
    renderCard()

    await expandCard()
    await fireEvent.update(screen.getByLabelText("Alice's round 1 score"), '9')
    await save()
    expect(screen.getByText('Enter a multiple of 5 from 0 to 1,000.')).toBeTruthy()

    await fireEvent.update(screen.getByLabelText("Alice's round 1 score"), '10')
    await save()
    expect(screen.queryByText('Enter a multiple of 5 from 0 to 1,000.')).toBeNull()
  })

  it('returns focus to the card header when Escape collapses it', async () => {
    const { container } = renderCard()

    await expandCard()
    await fireEvent.keyDown(container.firstElementChild!, { key: 'Escape' })
    await flushPromises()

    expect(document.activeElement).toBe(headerButton())
  })

  it('returns focus to the card header when Cancel collapses it', async () => {
    renderCard()

    await expandCard()
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await flushPromises()

    expect(document.activeElement).toBe(headerButton())
  })

  it('ignores the keyup of the Enter that opened the card, so it neither saves nor errors', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.keyUp(scoreInput(), { key: 'Enter' })

    expect(emitted().commit).toBeUndefined()
    expect(screen.queryByText('Enter the points first.')).toBeNull()
  })

  it('returns focus to the card header after committing with Enter', async () => {
    renderCard()

    await expandCard()
    const input = screen.getByLabelText("Alice's round 1 score")
    input.focus()
    await fireEvent.update(input, '10')
    await fireEvent.keyDown(input, { key: 'Enter' })
    await flushPromises()

    expect(document.activeElement).toBe(headerButton())
  })

  it('keeps the card open with its number when the field just loses focus, as when the keyboard closes', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.update(scoreInput(), '10')
    await fireEvent.blur(scoreInput())

    expect(emitted().commit).toBeUndefined()
    expect(scoreInput().value).toBe('10')
  })

  it('cancels expansion when Cancel is clicked', async () => {
    renderCard()

    await expandCard()
    expect(screen.getByLabelText("Alice's round 1 score")).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText("Alice's round 1 score")).toBeNull()
  })
})

describe('ScoreCard, the Save button', () => {
  function saveButton(): HTMLElement {
    return screen.getByRole('button', { name: 'Save' })
  }

  it('saves the typed score, collapses and hands focus back to the card', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.update(scoreInput(), '25')
    await fireEvent.click(saveButton())
    await flushPromises()

    expect(emitted().commit).toEqual([[ALICE.id, 1, 25]])
    expect(screen.queryByLabelText("Alice's round 1 score")).toBeNull()
    expect(document.activeElement).toBe(headerButton())
  })

  it('saves once when the tap on Save also blurs the field', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.update(scoreInput(), '25')
    await pressInsideCard(saveButton())

    expect(emitted().commit).toEqual([[ALICE.id, 1, 25]])
  })

  it('keeps the card open with the error for a score that is not a multiple of 5', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.update(scoreInput(), '12')
    await fireEvent.click(saveButton())

    expect(emitted().commit).toBeUndefined()
    expect(screen.getByRole('alert').textContent).toContain('multiple of 5')
    expect(scoreInput().value).toBe('12')
  })

  it('asks for the points when Save or Enter finds the field empty', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.click(saveButton())
    expect(screen.getByRole('alert').textContent).toBe('Enter the points first.')

    await fireEvent.update(scoreInput(), '')
    await fireEvent.keyDown(scoreInput(), { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toBe('Enter the points first.')
    expect(emitted().commit).toBeUndefined()
  })

  it('says nothing when an empty field is simply left', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.blur(scoreInput())

    expect(screen.queryByRole('alert')).toBeNull()
    expect(emitted().commit).toBeUndefined()
  })
})

describe('ScoreCard with the keyboard up', () => {
  it("never scrolls the page when the visible area resizes, so it can't fight the player's own scrolling", async () => {
    renderCard()
    await expandCard()
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    window.dispatchEvent(new Event('resize'))
    window.visualViewport?.dispatchEvent(new Event('resize'))
    window.visualViewport?.dispatchEvent(new Event('scroll'))

    expect(scrollBy).not.toHaveBeenCalled()
    scrollBy.mockRestore()
  })
})

describe('ScoreCard, a tap outside', () => {
  it('closes the card and throws the typed number away: only ✓ or Enter saves', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.update(scoreInput(), '25')
    await fireEvent.pointerUp(document.body)
    await flushPromises()

    expect(emitted().commit).toBeUndefined()
    expect(screen.queryByLabelText("Alice's round 1 score")).toBeNull()
    await expandCard()
    expect(scoreInput().value).toBe('')
  })

  it('leaves the card open for a tap inside it', async () => {
    renderCard()

    await expandCard()
    await fireEvent.update(scoreInput(), '25')
    await fireEvent.pointerUp(headerButton())
    await flushPromises()

    expect(scoreInput().value).toBe('25')
  })
})

describe('ScoreCard for a missed round', () => {
  it('names the round in its label and shows it on the card', () => {
    renderCard({ round: 2, isMissedRound: true })

    expect(screen.getByRole('button', { name: "Fill in Alice's missed round 2" })).toBeTruthy()
    expect(screen.getByText('Round 2')).toBeTruthy()
  })

  it('saves the score for that round, not the current one', async () => {
    const { emitted } = renderCard({ round: 2, isMissedRound: true })

    await fireEvent.click(screen.getByRole('button', { name: "Fill in Alice's missed round 2" }))
    await fireEvent.update(screen.getByLabelText("Alice's round 2 score"), '15')
    await save()

    expect(emitted().commit).toEqual([[ALICE.id, 2, 15]])
  })
})

describe('ScoreCard, discarding and saving a draft', () => {
  it('discards the typed score when Cancel is pressed', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.update(scoreInput(), '25')
    await pressInsideCard(screen.getByRole('button', { name: 'Cancel' }))

    expect(emitted().commit).toBeUndefined()
    expect(screen.queryByLabelText("Alice's round 1 score")).toBeNull()
    await expandCard()
    expect(scoreInput().value).toBe('')
  })

  it('keeps the draft when Tab moves focus to Cancel, then discards it on Cancel', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.update(scoreInput(), '25')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    await fireEvent.blur(scoreInput(), { relatedTarget: cancel })

    expect(emitted().commit).toBeUndefined()
    expect(scoreInput().value).toBe('25')

    await fireEvent.click(cancel)
    expect(emitted().commit).toBeUndefined()
  })

  it('discards the typed score on Escape even when the browser then blurs the removed input', async () => {
    const { emitted, container } = renderCard()

    await expandCard()
    await fireEvent.update(scoreInput(), '40')
    await keyThenRemovalBlur(() =>
      fireEvent.keyDown(container.firstElementChild!, { key: 'Escape' }),
    )

    expect(emitted().commit).toBeUndefined()
  })

  it('saves once on Enter even when the browser then blurs the removed input', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.update(scoreInput(), '25')
    await keyThenRemovalBlur(() => fireEvent.keyDown(scoreInput(), { key: 'Enter' }))

    expect(emitted().commit).toEqual([[ALICE.id, 1, 25]])
  })

  it('restores the last saved score when a later edit is cancelled', async () => {
    const { emitted, container } = renderCard()

    await expandCard()
    await fireEvent.update(scoreInput(), '10')
    await save()
    await expandCard()
    await fireEvent.update(scoreInput(), '20')
    await fireEvent.keyDown(container.firstElementChild!, { key: 'Escape' })
    await expandCard()

    expect(scoreInput().value).toBe('10')
    expect(emitted().commit).toEqual([[ALICE.id, 1, 10]])
  })
})

describe('ScoreCard photo-count affordance', () => {
  it('is hidden by default (offline / not this device own row)', async () => {
    renderCard()

    await expandCard()
    expect(scoreInput()).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Snap cards' })).toBeNull()
  })

  it('is hidden when canUsePhotoCount is true but there is no room code', async () => {
    renderCard({ canUsePhotoCount: true, roomCode: null })

    await expandCard()
    expect(screen.queryByRole('button', { name: 'Snap cards' })).toBeNull()
  })

  it('is hidden when a room code is present but canUsePhotoCount is false', async () => {
    renderCard({ canUsePhotoCount: false, roomCode: 'ABCDE' })

    await expandCard()
    expect(screen.queryByRole('button', { name: 'Snap cards' })).toBeNull()
  })

  it('shows once online AND this is the device own row', async () => {
    renderCard({ canUsePhotoCount: true, roomCode: 'ABCDE' })

    await expandCard()
    expect(screen.getByRole('button', { name: 'Snap cards' })).toBeTruthy()
  })

  it('sits in the name row only while the card is open, with the parent actions beside it', async () => {
    render(ScoreCard, {
      props: { player: ALICE, round: 1, canUsePhotoCount: true, roomCode: 'ABCDE' },
      slots: { actions: '<button type="button">Remove Alice</button>' },
      global: { plugins: [i18n] },
    })

    expect(screen.queryByRole('button', { name: 'Snap cards' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove Alice' })).toBeNull()
    await expandCard()

    const nameRow = headerButton().parentElement as HTMLElement
    expect(within(nameRow).getByRole('button', { name: 'Snap cards' })).toBeTruthy()
    expect(within(nameRow).getByRole('button', { name: 'Remove Alice' })).toBeTruthy()
  })
})

describe('ScoreCard photo-count after typing', () => {
  it('opens the photo sheet instead of saving when Snap cards is pressed after typing', async () => {
    const { emitted } = renderCard({ canUsePhotoCount: true, roomCode: 'ABCDE' })

    await expandCard()
    await fireEvent.update(scoreInput(), '25')
    await pressInsideCard(screen.getByRole('button', { name: 'Snap cards' }))

    expect(emitted().commit).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Take or choose a photo' })).toBeTruthy()
  })
})

describe('ScoreCard, confirming a photo-count result', () => {
  it('commits the confirmed total through the same path as manual entry', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [{ rank: '4', suit: 'diamonds', value: 5 }],
      total: 5,
    })
    const { emitted } = renderCard({ canUsePhotoCount: true, roomCode: 'ABCDE' })

    await expandCard()
    await selectPhoto()
    await fireEvent.click(screen.getByRole('button', { name: 'Use this total' }))

    expect(emitted().commit).toEqual([[ALICE.id, 1, 5]])
    await flushPromises()
    expect(document.activeElement).toBe(headerButton())
  })

  it('never commits when the photo read fails', async () => {
    countCardsMock.mockResolvedValue({ ok: false, reason: 'invalid-response' })
    const { emitted } = renderCard({ canUsePhotoCount: true, roomCode: 'ABCDE' })

    await expandCard()
    await selectPhoto()

    expect(emitted().commit).toBeUndefined()
    expect(screen.getByText("Couldn't read the cards — type the total instead.")).toBeTruthy()
  })

  it('rejects a negative edited total', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [{ rank: '4', suit: 'diamonds', value: 5 }],
      total: 5,
    })
    const { emitted } = renderCard({ canUsePhotoCount: true, roomCode: 'ABCDE' })

    await expandCard()
    await selectPhoto()
    await fireEvent.update(screen.getByLabelText('Total'), '-5')
    await fireEvent.click(screen.getByRole('button', { name: 'Use this total' }))

    expect(emitted().commit).toBeUndefined()
    expect(screen.getByText('Enter a multiple of 5 from 0 to 1,000.')).toBeTruthy()
  })

  it('rejects a fractional edited total', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [{ rank: '4', suit: 'diamonds', value: 5 }],
      total: 5,
    })
    const { emitted } = renderCard({ canUsePhotoCount: true, roomCode: 'ABCDE' })

    await expandCard()
    await selectPhoto()
    await fireEvent.update(screen.getByLabelText('Total'), '4.5')
    await fireEvent.click(screen.getByRole('button', { name: 'Use this total' }))

    expect(emitted().commit).toBeUndefined()
    expect(screen.getByText('Enter a multiple of 5 from 0 to 1,000.')).toBeTruthy()
  })
})

describe('ScoreCard, a saved score', () => {
  it('shows the saved points on the collapsed card when this device may see them', () => {
    renderCard({ scoredPoints: 15, showPoints: true })

    expect(screen.getByText('15 pts')).toBeTruthy()
    expect(headerButton().getAttribute('aria-label')).toBe("Edit Alice's score (15 points)")
  })

  it('shows a scored zero as 0, not as unscored', () => {
    renderCard({ scoredPoints: 0, showPoints: true })

    expect(screen.getByText('0 pts')).toBeTruthy()
    expect(headerButton().getAttribute('aria-label')).toBe("Edit Alice's score (0 points)")
  })

  it('shows only "Scored" when the number is not this device\'s to see', () => {
    renderCard({ scoredPoints: 20, showPoints: false })

    expect(screen.getByText('Scored')).toBeTruthy()
    expect(screen.queryByText('20 pts')).toBeNull()
    expect(headerButton().getAttribute('aria-label')).toBe("Edit Alice's score (scored)")
  })

  it('starts editing from the saved value, and Cancel restores it', async () => {
    renderCard({ scoredPoints: 15, showPoints: true })

    await expandCard()
    expect(scoreInput().value).toBe('15')
    await fireEvent.update(scoreInput(), '20')
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expandCard()

    expect(scoreInput().value).toBe('15')
  })

  it('starts editing from an empty field when the number is hidden', async () => {
    renderCard({ scoredPoints: 20, showPoints: false })

    await expandCard()

    expect(scoreInput().value).toBe('')
  })
})

describe("ScoreCard, a player's own card", () => {
  it('says "Enter your points" instead of the player\'s name', () => {
    renderCard({ isOwnCard: true })

    const header = screen.getByRole('button', { name: 'Enter your points' })
    expect(header.textContent).toContain('Enter your points')
    expect(header.textContent).not.toContain('Alice')
  })

  it('labels the input as your own points', async () => {
    renderCard({ isOwnCard: true })

    await fireEvent.click(screen.getByRole('button', { name: 'Enter your points' }))

    expect(screen.getByLabelText('Your round 1 points')).toBeTruthy()
  })

  it('includes the saved points in the spoken name', () => {
    renderCard({ isOwnCard: true, scoredPoints: 15, showPoints: true })

    expect(screen.getByRole('button', { name: 'Enter your points (15 points saved)' })).toBeTruthy()
    expect(screen.getByText('15 pts')).toBeTruthy()
  })

  it('names a missed round on your own card', () => {
    renderCard({ isOwnCard: true, isMissedRound: true, round: 2 })

    expect(
      screen.getByRole('button', { name: 'Enter your points for missed round 2' }),
    ).toBeTruthy()
  })
})
