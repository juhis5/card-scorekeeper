import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import ScoreCard from './ScoreCard.vue'
import { i18n } from '@/i18n'
import type { Player } from '@/lib/types'

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

/** What a real browser does when a control inside the card is pressed while the input has focus:
 * pointerdown, then the input blurs, then the click. iOS Safari doesn't focus a tapped button,
 * so the blur carries no relatedTarget. */
async function pressInsideCard(control: HTMLElement): Promise<void> {
  await fireEvent.pointerDown(control)
  scoreInput().blur()
  await fireEvent.click(control)
}

/** Chromium blurs a focused input when it's removed from the DOM. Collapsing the card removes it,
 * so dispatch that blur synchronously right after the key event, before Vue patches the DOM. */
async function keyThenRemovalBlur(sendKey: () => Promise<unknown>): Promise<void> {
  const input = scoreInput()
  const pending = sendKey()
  input.dispatchEvent(new FocusEvent('blur'))
  await pending
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
    await fireEvent.blur(screen.getByLabelText("Alice's round 1 score"))

    expect(emitted().commit).toEqual([[ALICE.id, 1, 10]])
    // Card collapses after commit
    expect(screen.queryByLabelText("Alice's round 1 score")).toBeNull()
  })

  it('shows "Scored" indicator when isScored is true', () => {
    renderCard({ isScored: true })

    expect(screen.getByText('Scored')).toBeTruthy()
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
    await fireEvent.blur(screen.getByLabelText("Alice's round 1 score"))

    expect(screen.getByText('Enter a multiple of 5 from 0 to 1,000.')).toBeTruthy()
  })

  it('rejects a score over the 1000-point cap instead of saving it', async () => {
    const { emitted } = renderCard()

    await expandCard()
    await fireEvent.update(screen.getByLabelText("Alice's round 1 score"), '1005')
    await fireEvent.blur(screen.getByLabelText("Alice's round 1 score"))

    expect(emitted().commit).toBeUndefined()
    expect(screen.getByText('Enter a multiple of 5 from 0 to 1,000.')).toBeTruthy()
  })

  it('clears the error when a valid score is entered', async () => {
    renderCard()

    await expandCard()
    await fireEvent.update(screen.getByLabelText("Alice's round 1 score"), '9')
    await fireEvent.blur(screen.getByLabelText("Alice's round 1 score"))
    expect(screen.getByText('Enter a multiple of 5 from 0 to 1,000.')).toBeTruthy()

    await fireEvent.update(screen.getByLabelText("Alice's round 1 score"), '10')
    await fireEvent.blur(screen.getByLabelText("Alice's round 1 score"))
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

  it('returns focus to the card header after committing with Enter', async () => {
    renderCard()

    await expandCard()
    const input = screen.getByLabelText("Alice's round 1 score")
    input.focus()
    await fireEvent.update(input, '10')
    await fireEvent.keyUp(input, { key: 'Enter' })
    await flushPromises()

    expect(document.activeElement).toBe(headerButton())
  })

  it('does not pull focus back when a blur commit moves focus elsewhere', async () => {
    renderCard()
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)

    await expandCard()
    const input = screen.getByLabelText("Alice's round 1 score")
    input.focus()
    await fireEvent.update(input, '10')
    elsewhere.focus()
    await flushPromises()

    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })

  it('cancels expansion when Cancel is clicked', async () => {
    renderCard()

    await expandCard()
    expect(screen.getByLabelText("Alice's round 1 score")).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText("Alice's round 1 score")).toBeNull()
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
    await fireEvent.blur(screen.getByLabelText("Alice's round 2 score"))

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
    await keyThenRemovalBlur(() => fireEvent.keyUp(scoreInput(), { key: 'Enter' }))

    expect(emitted().commit).toEqual([[ALICE.id, 1, 25]])
  })

  it('restores the last saved score when a later edit is cancelled', async () => {
    const { emitted, container } = renderCard()

    await expandCard()
    await fireEvent.update(scoreInput(), '10')
    await fireEvent.blur(scoreInput())
    await expandCard()
    await fireEvent.update(scoreInput(), '20')
    await fireEvent.keyDown(container.firstElementChild!, { key: 'Escape' })
    await expandCard()

    expect(scoreInput().value).toBe('10')
    expect(emitted().commit).toEqual([[ALICE.id, 1, 10]])
  })
})

describe('ScoreCard photo-count affordance', () => {
  it('is hidden by default (offline / not this device own row)', () => {
    renderCard()

    // Card must be expanded first to see photo count
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
    countCardsMock.mockResolvedValue({ ok: false, reason: 'network' })
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
