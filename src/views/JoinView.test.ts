import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import JoinView from './JoinView.vue'
import { i18n } from '@/i18n'
import type { RoomAvailability, Seat } from '@/lib/data/repository'

const { resumeRepository, joinRepository } = vi.hoisted(() => ({
  resumeRepository: vi.fn(),
  joinRepository: vi.fn(),
}))

vi.mock('@/composables/useGameConnectivity', () => ({
  useGameConnectivity: () => ({ resumeRepository, joinRepository }),
}))

function roomReader(seat: Seat | null, availability: RoomAvailability = 'open') {
  return {
    findSeat: vi.fn().mockResolvedValue(seat),
    roomAvailability: vi.fn().mockResolvedValue(availability),
  }
}

async function renderAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { render: () => null } },
      { path: '/room/:code', name: 'room', component: { render: () => null } },
      { path: '/join/:code', name: 'join', component: JoinView },
    ],
  })
  await router.push(path)
  render(JoinView, { global: { plugins: [i18n, router] } })
  await flushPromises()
  return router
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  resumeRepository.mockReset()
  joinRepository.mockReset()
})

describe('JoinView', () => {
  it('asks only for a name, for the room in the link', async () => {
    resumeRepository.mockResolvedValue(roomReader(null))
    joinRepository.mockResolvedValue({ kind: 'unreachable' })
    await renderAt('/join/7k4rq')

    expect(screen.getByRole('heading', { level: 1, name: 'Join room 7K4RQ' })).toBeTruthy()
    expect(screen.queryByLabelText('Room code')).toBeNull()
    await fireEvent.update(screen.getByLabelText('Your name'), 'Alice')
    await fireEvent.click(screen.getByRole('button', { name: 'Join game' }))
    await flushPromises()

    expect(joinRepository).toHaveBeenCalledWith('7K4RQ')
  })

  it('goes straight to the room when this device already has a seat there', async () => {
    resumeRepository.mockResolvedValue(roomReader({ playerId: 'alice-uid', isHost: false }))

    const router = await renderAt('/join/7K4RQ')

    expect(router.currentRoute.value.name).toBe('room')
    expect(router.currentRoute.value.params.code).toBe('7K4RQ')
  })

  it.each([
    ['finished', 'This game has already ended.'],
    ['expired', 'This room has expired.'],
    ['missing', 'There is no room 7K4RQ. Check the code.'],
  ] as const)(
    'says a %s room can no longer be joined, with the way home',
    async (availability, message) => {
      resumeRepository.mockResolvedValue(roomReader(null, availability))

      await renderAt('/join/7K4RQ')

      expect(screen.getByText(message)).toBeTruthy()
      expect(screen.queryByLabelText('Your name')).toBeNull()
      expect(screen.getByRole('link', { name: 'Back to home' })).toBeTruthy()
    },
  )

  it('says so when the link has no room code, without reading anything', async () => {
    await renderAt('/join/not-a-code')

    expect(screen.getByText("That link doesn't have a room code in it.")).toBeTruthy()
    expect(resumeRepository).not.toHaveBeenCalled()
  })

  it("shows the form anyway when the room can't be read, so a join can say why", async () => {
    resumeRepository.mockResolvedValue({
      findSeat: vi.fn().mockRejectedValue(new Error('offline')),
      roomAvailability: vi.fn(),
    })

    await renderAt('/join/7K4RQ')

    expect(screen.getByLabelText('Your name')).toBeTruthy()
  })
})
