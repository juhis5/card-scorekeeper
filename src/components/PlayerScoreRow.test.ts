import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import PlayerScoreRow from './PlayerScoreRow.vue'
import { i18n } from '@/i18n'
import type { Player } from '@/lib/types'

const countCardsMock = vi.fn()

// A REAL ref (not a plain `{ value: false }` object) — see PhotoCountSheet.test.ts's identical
// mock for why: the component reads `isPending` through Vue's runtime `unref()`, which only
// unwraps genuine refs, so a plain object would read as permanently truthy.
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

function renderRow(props: Partial<InstanceType<typeof PlayerScoreRow>['$props']> = {}) {
  return render(PlayerScoreRow, {
    props: { player: ALICE, round: 1, ...props },
    global: { plugins: [i18n] },
  })
}

/** Opens the "Snap cards" sheet, taps "take a photo", and picks a fake file — mirrors the real
 * trigger-then-camera flow a player goes through on a phone. */
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

describe('PlayerScoreRow, the "Snap cards" affordance', () => {
  it("is hidden by default (offline / not this device's own row)", () => {
    renderRow()

    expect(screen.queryByRole('button', { name: 'Snap cards' })).toBeNull()
  })

  it('is hidden when canUsePhotoCount is true but there is no room code', () => {
    renderRow({ canUsePhotoCount: true, roomCode: null })

    expect(screen.queryByRole('button', { name: 'Snap cards' })).toBeNull()
  })

  it("is hidden when a room code is present but canUsePhotoCount is false (not this device's row)", () => {
    renderRow({ canUsePhotoCount: false, roomCode: 'ABCDE' })

    expect(screen.queryByRole('button', { name: 'Snap cards' })).toBeNull()
  })

  it("shows once online AND this is the device's own row", () => {
    renderRow({ canUsePhotoCount: true, roomCode: 'ABCDE' })

    expect(screen.getByRole('button', { name: 'Snap cards' })).toBeTruthy()
  })
})

describe('PlayerScoreRow, confirming a photo-count result', () => {
  it('commits the confirmed total through the same path as manual entry', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [{ rank: '4', suit: 'diamonds', value: 4 }],
      total: 4,
    })
    const { emitted } = renderRow({ canUsePhotoCount: true, roomCode: 'ABCDE' })

    await selectPhoto()
    await fireEvent.click(screen.getByRole('button', { name: 'Use this total' }))

    expect(emitted().commit).toEqual([[ALICE.id, 4]])
    // The manual score field itself reflects the confirmed number, same as if it had been typed.
    expect((screen.getByLabelText("Alice's round 1 score") as HTMLInputElement).value).toBe('4')
  })

  it('never commits when the photo read fails — the manual field stays ready', async () => {
    countCardsMock.mockResolvedValue({ ok: false, reason: 'network' })
    const { emitted } = renderRow({ canUsePhotoCount: true, roomCode: 'ABCDE' })

    await selectPhoto()

    expect(emitted().commit).toBeUndefined()
    expect(screen.getByText("Couldn't read the cards — type the total instead.")).toBeTruthy()
    expect(screen.getByLabelText("Alice's round 1 score")).toBeTruthy()
  })

  // The photo is only ever a SUGGESTION (see CLAUDE.md) — the server always recomputes a valid
  // (non-negative integer) total from the card list, so the only realistic way an out-of-range
  // total reaches `confirm` is the player editing it directly in the sheet. That edit must be
  // caught by the SAME shared validation manual entry uses, not silently accepted, and must never
  // reach `commit`. Pinned explicitly rather than relying on a manual check (review follow-up).
  it('never commits a confirmed total the player edited to a negative number', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [{ rank: '4', suit: 'diamonds', value: 4 }],
      total: 4,
    })
    const { emitted } = renderRow({ canUsePhotoCount: true, roomCode: 'ABCDE' })

    await selectPhoto()
    await fireEvent.update(screen.getByLabelText('Total'), '-5')
    await fireEvent.click(screen.getByRole('button', { name: 'Use this total' }))

    expect(emitted().commit).toBeUndefined()
    expect(screen.getByText('Enter a whole number of 0 or more.')).toBeTruthy()
  })

  it('never commits a confirmed total the player edited to a fractional number', async () => {
    countCardsMock.mockResolvedValue({
      ok: true,
      cards: [{ rank: '4', suit: 'diamonds', value: 4 }],
      total: 4,
    })
    const { emitted } = renderRow({ canUsePhotoCount: true, roomCode: 'ABCDE' })

    await selectPhoto()
    await fireEvent.update(screen.getByLabelText('Total'), '4.5')
    await fireEvent.click(screen.getByRole('button', { name: 'Use this total' }))

    expect(emitted().commit).toBeUndefined()
    expect(screen.getByText('Enter a whole number of 0 or more.')).toBeTruthy()
  })
})
