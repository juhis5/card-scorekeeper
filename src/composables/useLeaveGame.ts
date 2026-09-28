/**
 * What Home's ✕ does to a game in progress (fifth round): a local game is deleted, a host ends an
 * online game for everyone, a player only forgets it on this device (their seat stays). Home can't
 * tell who hosts a room without asking the room, so it asks; offline, the room is only forgotten.
 */
import { forgetRoom } from '@/lib/data/last-room'
import { LocalGameRepository } from '@/lib/data/local-repository'
import { useGameConnectivity } from '@/composables/useGameConnectivity'
import { useGameStore } from '@/stores/game'

export function useLeaveGame() {
  const game = useGameStore()
  const { resumeRepository } = useGameConnectivity()

  async function leaveOnlineRoom(code: string): Promise<void> {
    if (game.roomCode === code) {
      if (game.isHost) await game.abandonGame().catch(() => game.leaveGame())
      else game.leaveGame()
      return
    }
    const repository = await resumeRepository(code)
    const seat = repository ? await repository.findSeat().catch(() => null) : null
    // A host whose ending doesn't go through (no connection) still gets the room off Home; the
    // confirm said so.
    if (repository && seat?.isHost) await repository.abandonGame().catch(() => undefined)
    forgetRoom(code)
  }

  async function deleteLocalGame(): Promise<void> {
    if (game.gameId !== null && !game.isOnline) {
      await game.abandonGame()
      return
    }
    await new LocalGameRepository().abandonGame()
  }

  return { leaveOnlineRoom, deleteLocalGame }
}
