import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import PhotoCountSheet from './PhotoCountSheet.vue'
import { i18n } from '@/i18n'

const countCardsMock = vi.fn()

// A real ref: the template unwraps `isPending` with `unref()`, which leaves a plain object as is,
// so the pending branch would never clear. Flipped around the call like the real composable.
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

function makeFile(): File {
  return new File(['fake-bytes'], 'hand.jpg', { type: 'image/jpeg' })
}

function renderSheet() {
  return render(PhotoCountSheet, {
    props: { id: 'photo-alice', roomCode: 'ABCDE' },
    global: { plugins: [i18n] },
  })
}

/** Opens the sheet, taps "take a photo" and picks a fake file, as on a phone. */
async function selectAPhoto(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'Snap cards' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Take or choose a photo' }))
  const fileInput = screen.getByTestId('photo-count-file') as HTMLInputElement
  await fireEvent.change(fileInput, { target: { files: [makeFile()] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  // A "never resolves" test leaves this stuck at true.
  isPendingMock.value = false
})

describe('PhotoCountSheet, before a photo is picked', () => {
  it('shows the trigger and, once opened, the flat-cards hint and take-photo action', async () => {
    renderSheet()

    expect(screen.getByRole('button', { name: 'Snap cards' })).toBeTruthy()
    expect(screen.queryByText(/lay your cards flat/i)).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Snap cards' }))

    expect(screen.getByText(/lay your cards flat/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Take or choose a photo' })).toBeTruthy()
  })

  it('never emits confirm when the sheet is cancelled without picking a photo', async () => {
    const { emitted } = renderSheet()

    await fireEvent.click(screen.getByRole('button', { name: 'Snap cards' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(emitted().confirm).toBeUndefined()
    expect(countCardsMock).not.toHaveBeenCalled()
  })
})

describe('PhotoCountSheet, reading in progress', () => {
  it('shows a polite "reading" status while the request is in flight', async () => {
    countCardsMock.mockReturnValue(new Promise(() => {})) // never resolves in this test
    renderSheet()

    await selectAPhoto()

    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Reading your cards…')
  })

  it('sends the room code and file to countCards', async () => {
    countCardsMock.mockReturnValue(new Promise(() => {}))
    renderSheet()

    await selectAPhoto()

    expect(countCardsMock).toHaveBeenCalledWith('ABCDE', expect.any(File))
  })
})

describe('PhotoCountSheet, a successful read', () => {
  const CARDS = [
    { rank: '4', suit: 'diamonds', value: 5 },
    { rank: 'K', suit: 'spades', value: 10 },
    { rank: 'Joker', suit: null, value: 25 },
  ]

  it('shows the detected cards and the total', async () => {
    countCardsMock.mockResolvedValue({ ok: true, cards: CARDS, total: 40 })
    renderSheet()

    await selectAPhoto()
    await flushPromises()

    expect(screen.getByText('4♦')).toBeTruthy()
    expect(screen.getByText('K♠')).toBeTruthy()
    expect(screen.getByText('Joker')).toBeTruthy()
    expect((screen.getByLabelText('Total') as HTMLInputElement).value).toBe('40')
  })

  it('politely announces the result for a screen-reader user not watching the screen', async () => {
    countCardsMock.mockResolvedValue({ ok: true, cards: CARDS, total: 40 })
    renderSheet()

    await selectAPhoto()
    await flushPromises()

    expect(screen.getByText('Found 3 cards, total 40 points. Review and confirm.')).toBeTruthy()
  })

  it('recomputes the total when a card value is edited', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [
        { rank: '4', suit: 'diamonds', value: 5 },
        { rank: 'K', suit: 'spades', value: 10 },
      ],
      total: 15,
    })
    renderSheet()
    await selectAPhoto()
    await flushPromises()

    const cardValueInput = screen.getByLabelText('Card 1 of 2: 4 of diamonds')
    await fireEvent.update(cardValueInput, '10')

    expect((screen.getByLabelText('Total') as HTMLInputElement).value).toBe('20')
  })

  it('lets the player override the total directly, independent of the card breakdown', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [{ rank: '4', suit: 'diamonds', value: 5 }],
      total: 5,
    })
    renderSheet()
    await selectAPhoto()
    await flushPromises()

    const totalInput = screen.getByLabelText('Total')
    await fireEvent.update(totalInput, '50')

    expect((totalInput as HTMLInputElement).value).toBe('50')
  })

  it('confirms the current total and closes the sheet', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [{ rank: '4', suit: 'diamonds', value: 5 }],
      total: 5,
    })
    const { emitted } = renderSheet()
    await selectAPhoto()
    await flushPromises()

    await fireEvent.click(screen.getByRole('button', { name: 'Use this total' }))
    await flushPromises()

    expect(emitted().confirm).toEqual([[5]])
    expect(screen.queryByRole('button', { name: 'Use this total' })).toBeNull()
  })
})

describe('PhotoCountSheet, a failed read', () => {
  it('shows a friendly error and a retry action instead of a raw error', async () => {
    countCardsMock.mockResolvedValue({ ok: false, reason: 'invalid-response' })
    renderSheet()

    await selectAPhoto()
    await flushPromises()

    expect(screen.getByText("Couldn't read the cards — type the total instead.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('never emits confirm on a failed read', async () => {
    countCardsMock.mockResolvedValue({ ok: false, reason: 'server-error' })
    const { emitted } = renderSheet()

    await selectAPhoto()
    await flushPromises()

    expect(emitted().confirm).toBeUndefined()
  })
})

describe('PhotoCountSheet, telling failures apart', () => {
  it.each([
    [
      'unauthenticated',
      "Couldn't confirm your session. Reload the page, or type your total.",
      false,
    ],
    ['forbidden', "Photo counting isn't available in this room anymore. Type your total.", false],
    ['rate-limited', 'Too many photos right now. Wait a moment, or type your total.', true],
    ['timeout', 'Reading the photo took too long. Try again, or type your total.', true],
    ['network', "Couldn't reach photo counting. Check your connection, or type your total.", true],
    [
      'unavailable',
      "Photo counting isn't responding right now. Try again later, or type your total.",
      true,
    ],
    ['image-processing', "Couldn't use that photo. Try another one, or type your total.", true],
    ['invalid-response', "Couldn't read the cards — type the total instead.", true],
    ['server-error', "Photo counting isn't working right now. Type your total.", false],
  ] as const)('on %s says "%s" (retry offered: %s)', async (reason, message, canRetry) => {
    countCardsMock.mockResolvedValue({ ok: false, reason })
    renderSheet()

    await selectAPhoto()
    await flushPromises()

    expect(screen.getByRole('alert').textContent).toContain(message)
    expect(screen.queryByRole('button', { name: 'Try again' }) !== null).toBe(canRetry)
  })
})

describe('PhotoCountSheet, editing the total', () => {
  const CARDS = [
    { rank: '7', suit: 'hearts', value: 5 },
    { rank: 'K', suit: 'spades', value: 10 },
  ]

  it('keeps a cleared total empty and disables confirming until a valid total is typed', async () => {
    countCardsMock.mockResolvedValue({ ok: true, cards: CARDS, total: 15 })
    renderSheet()
    await selectAPhoto()
    await flushPromises()

    await fireEvent.update(screen.getByLabelText('Total'), '')

    expect((screen.getByLabelText('Total') as HTMLInputElement).value).toBe('')
    expect(
      (screen.getByRole('button', { name: 'Use this total' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('refuses a total that is not a valid round score', async () => {
    countCardsMock.mockResolvedValue({ ok: true, cards: CARDS, total: 15 })
    renderSheet()
    await selectAPhoto()
    await flushPromises()

    await fireEvent.update(screen.getByLabelText('Total'), '17')

    expect(screen.getByText('Enter a multiple of 5 from 0 to 1,000.')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Use this total' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe('PhotoCountSheet, repeated cards from 2-3 decks', () => {
  it('gives each copy its own spoken label and counts every one', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [
        { rank: '7', suit: 'hearts', value: 5 },
        { rank: '7', suit: 'hearts', value: 5 },
        { rank: 'Joker', suit: null, value: 25 },
        { rank: 'Joker', suit: null, value: 25 },
      ],
      total: 60,
    })
    renderSheet()
    await selectAPhoto()
    await flushPromises()

    expect(screen.getByLabelText('Card 1 of 4: 7 of hearts')).toBeTruthy()
    expect(screen.getByLabelText('Card 2 of 4: 7 of hearts')).toBeTruthy()
    expect(screen.getByLabelText('Card 4 of 4: joker')).toBeTruthy()
    expect((screen.getByLabelText('Total') as HTMLInputElement).value).toBe('60')
  })

  it('announces a single card in the singular', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [{ rank: 'A', suit: 'spades', value: 15 }],
      total: 15,
    })
    renderSheet()
    await selectAPhoto()
    await flushPromises()

    expect(screen.getByText('Found 1 card, total 15 points. Review and confirm.')).toBeTruthy()
  })
})

describe('PhotoCountSheet, in Finnish', () => {
  afterEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('names each card in Finnish and uses the Finnish plural', async () => {
    i18n.global.locale.value = 'fi'
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [
        { rank: 'Q', suit: 'hearts', value: 10 },
        { rank: 'Joker', suit: null, value: 25 },
      ],
      total: 35,
    })
    renderSheet()

    await fireEvent.click(screen.getByRole('button', { name: 'Kuvaa kortit' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Ota tai valitse kuva' }))
    await fireEvent.change(screen.getByTestId('photo-count-file'), {
      target: { files: [makeFile()] },
    })
    await flushPromises()

    expect(screen.getByLabelText('Kortti 1/2: hertta rouva')).toBeTruthy()
    expect(screen.getByLabelText('Kortti 2/2: jokeri')).toBeTruthy()
    expect(
      screen.getByText('Löytyi 2 korttia, summa 35 pistettä. Tarkista ja vahvista.'),
    ).toBeTruthy()
  })
})
