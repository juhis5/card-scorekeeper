import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import PhotoCountSheet from './PhotoCountSheet.vue'
import { i18n } from '@/i18n'

const countCardsMock = vi.fn()

// A REAL ref, not a plain `{ value: false }` object — the component's template reads `isPending`
// via Vue's runtime `unref()`, which only unwraps genuine refs (checked via `isRef()`); a plain
// object would stay truthy forever and the pending branch would never clear (found in review).
// Flipped around `countCardsMock`'s call here, mirroring the real composable's own
// try/finally, so tests get a realistic pending → settled transition for free.
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

/** Opens the sheet, taps "take a photo", and picks a fake file — mirrors the real
 * trigger-then-camera flow players go through on a phone. */
async function selectAPhoto(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'Snap cards' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Take or choose a photo' }))
  const fileInput = screen.getByTestId('photo-count-file') as HTMLInputElement
  await fireEvent.change(fileInput, { target: { files: [makeFile()] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  // A "never resolves" test (the in-flight/pending cases below) leaves this stuck `true` —
  // reset unconditionally so it can never bleed into an unrelated test's initial render.
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
    { rank: '4', suit: 'diamonds', value: 4 },
    { rank: 'K', suit: 'spades', value: 10 },
    { rank: 'Joker', suit: null, value: 25 },
  ]

  it('shows the detected cards and the total', async () => {
    countCardsMock.mockResolvedValue({ ok: true, cards: CARDS, total: 39 })
    renderSheet()

    await selectAPhoto()
    await flushPromises()

    expect(screen.getByText('4♦')).toBeTruthy()
    expect(screen.getByText('K♠')).toBeTruthy()
    expect(screen.getByText('Joker')).toBeTruthy()
    expect((screen.getByLabelText('Total') as HTMLInputElement).value).toBe('39')
  })

  it('politely announces the result for a screen-reader user not watching the screen', async () => {
    countCardsMock.mockResolvedValue({ ok: true, cards: CARDS, total: 39 })
    renderSheet()

    await selectAPhoto()
    await flushPromises()

    expect(screen.getByText('Found 3 cards, total 39 points. Review and confirm.')).toBeTruthy()
  })

  it('recomputes the total when a card value is edited', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [
        { rank: '4', suit: 'diamonds', value: 4 },
        { rank: 'K', suit: 'spades', value: 10 },
      ],
      total: 14,
    })
    renderSheet()
    await selectAPhoto()
    await flushPromises()

    const cardValueInput = screen.getByLabelText('4♦ value')
    await fireEvent.update(cardValueInput, '9')

    expect((screen.getByLabelText('Total') as HTMLInputElement).value).toBe('19')
  })

  it('lets the player override the total directly, independent of the card breakdown', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [{ rank: '4', suit: 'diamonds', value: 4 }],
      total: 4,
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
      cards: [{ rank: '4', suit: 'diamonds', value: 4 }],
      total: 4,
    })
    const { emitted } = renderSheet()
    await selectAPhoto()
    await flushPromises()

    await fireEvent.click(screen.getByRole('button', { name: 'Use this total' }))
    await flushPromises()

    expect(emitted().confirm).toEqual([[4]])
    expect(screen.queryByRole('button', { name: 'Use this total' })).toBeNull()
  })
})

describe('PhotoCountSheet, a failed read', () => {
  it('shows a friendly error and a retry action instead of a raw error', async () => {
    countCardsMock.mockResolvedValue({ ok: false, reason: 'network' })
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
