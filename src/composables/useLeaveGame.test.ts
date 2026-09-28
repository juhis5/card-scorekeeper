import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { lastRoom, rememberRoom } from '@/lib/data/last-room'
import type { ResumableGameRepository, Seat } from '@/lib/data/repository'

const { resumeRepository } = vi.hoisted(() => ({ resumeRepository: vi.fn() }))
vi.mock('@/composables/useGameConnectivity', () => ({
  useGameConnectivity: () => ({ resumeRepository }),
}))

const { useLeaveGame } = await import('./useLeaveGame')

function roomWithSeat(seat: Seat | null, abandon = vi.fn().mockResolvedValue(undefined)) {
  return {
    findSeat: vi.fn().mockResolvedValue(seat),
    abandonGame: abandon,
  } as unknown as ResumableGameRepository & { abandonGame: typeof abandon }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  resumeRepository.mockReset()
  rememberRoom('7K4RQ')
})

describe('useLeaveGame, a room Home remembers', () => {
  it('ends it for everyone when this device is its host, and forgets it', async () => {
    const room = roomWithSeat({ playerId: 'host', isHost: true })
    resumeRepository.mockResolvedValue(room)

    await useLeaveGame().leaveOnlineRoom('7K4RQ')

    expect(room.abandonGame).toHaveBeenCalledTimes(1)
    expect(lastRoom()).toBeNull()
  })

  it('only forgets it when this device is a player there', async () => {
    const room = roomWithSeat({ playerId: 'alice', isHost: false })
    resumeRepository.mockResolvedValue(room)

    await useLeaveGame().leaveOnlineRoom('7K4RQ')

    expect(room.abandonGame).not.toHaveBeenCalled()
    expect(lastRoom()).toBeNull()
  })

  it('still forgets it without a connection, even for its host', async () => {
    const room = roomWithSeat(
      { playerId: 'host', isHost: true },
      vi.fn().mockRejectedValue(new Error('offline')),
    )
    resumeRepository.mockResolvedValue(room)

    await useLeaveGame().leaveOnlineRoom('7K4RQ')

    expect(lastRoom()).toBeNull()
  })
})
