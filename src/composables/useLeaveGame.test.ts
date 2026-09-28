import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { lastRoom, rememberRoom } from '@/lib/data/last-room'
import { hasPersistedGame, LocalGameRepository } from '@/lib/data/local-repository'
import type { GameConfig, ResumableGameRepository, Seat } from '@/lib/data/repository'
import { useGameStore } from '@/stores/game'

const { resumeRepository } = vi.hoisted(() => ({ resumeRepository: vi.fn() }))
vi.mock('@/composables/useGameConnectivity', () => ({
  useGameConnectivity: () => ({ resumeRepository }),
}))

const { useLeaveGame } = await import('./useLeaveGame')

const HOST_CONFIG: GameConfig = { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' }

function roomWithSeat(seat: Seat | null, abandon = vi.fn().mockResolvedValue(undefined)) {
  return {
    findSeat: vi.fn().mockResolvedValue(seat),
    abandonGame: abandon,
    subscribe: () => () => undefined,
    leave: vi.fn(),
  } as unknown as ResumableGameRepository & { abandonGame: typeof abandon }
}

/** The room this device has open right now, rather than one Home only remembers. */
async function openRoom(room: ResumableGameRepository): Promise<ReturnType<typeof useGameStore>> {
  const game = useGameStore()
  await game.resumeOnline(room, '7K4RQ')
  return game
}

async function saveLocalGame(): Promise<void> {
  await new LocalGameRepository().createGame(HOST_CONFIG)
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

  it('still forgets it when Firebase could not load to ask the room', async () => {
    resumeRepository.mockResolvedValue(null)

    await useLeaveGame().leaveOnlineRoom('7K4RQ')

    expect(lastRoom()).toBeNull()
  })

  it('only forgets it, ending nothing, when looking up the seat fails', async () => {
    const room = roomWithSeat(null)
    vi.mocked(room.findSeat).mockRejectedValue(new Error('offline'))
    resumeRepository.mockResolvedValue(room)

    await useLeaveGame().leaveOnlineRoom('7K4RQ')

    expect(room.abandonGame).not.toHaveBeenCalled()
    expect(lastRoom()).toBeNull()
  })
})

describe('useLeaveGame, the room this device has open', () => {
  it('ends it for everyone through the store when this device hosts it, without asking the room again', async () => {
    const room = roomWithSeat({ playerId: 'host', isHost: true })
    const game = await openRoom(room)

    await useLeaveGame().leaveOnlineRoom('7K4RQ')

    expect(room.abandonGame).toHaveBeenCalledTimes(1)
    expect(resumeRepository).not.toHaveBeenCalled()
    expect(game.roomCode).toBeNull()
    expect(lastRoom()).toBeNull()
  })

  it('still leaves and forgets it when the host cannot end it (no connection)', async () => {
    const room = roomWithSeat(
      { playerId: 'host', isHost: true },
      vi.fn().mockRejectedValue(new Error('offline')),
    )
    const game = await openRoom(room)

    await useLeaveGame().leaveOnlineRoom('7K4RQ')

    expect(game.roomCode).toBeNull()
    expect(lastRoom()).toBeNull()
  })

  it('only leaves it on this device when this device is a player there', async () => {
    const room = roomWithSeat({ playerId: 'alice', isHost: false })
    const game = await openRoom(room)

    await useLeaveGame().leaveOnlineRoom('7K4RQ')

    expect(room.abandonGame).not.toHaveBeenCalled()
    expect(game.roomCode).toBeNull()
    expect(lastRoom()).toBeNull()
  })
})

describe('useLeaveGame().deleteLocalGame', () => {
  it('ends the local game the store has open and deletes it', async () => {
    const game = useGameStore()
    await game.start(new LocalGameRepository(), HOST_CONFIG)

    await useLeaveGame().deleteLocalGame()

    expect(game.gameId).toBeNull()
    expect(hasPersistedGame()).toBe(false)
  })

  it('deletes the saved local game when the store has nothing open', async () => {
    await saveLocalGame()

    await useLeaveGame().deleteLocalGame()

    expect(hasPersistedGame()).toBe(false)
  })

  it('deletes the saved local game but leaves an open online room alone', async () => {
    await saveLocalGame()
    const room = roomWithSeat({ playerId: 'host', isHost: true })
    const game = await openRoom(room)

    await useLeaveGame().deleteLocalGame()

    expect(hasPersistedGame()).toBe(false)
    expect(room.abandonGame).not.toHaveBeenCalled()
    expect(game.roomCode).toBe('7K4RQ')
  })
})
