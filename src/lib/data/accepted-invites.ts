/**
 * Invites this device accepted while their game was still running: they count once it finishes
 * (see reconnect-flush.ts). Kept here, without Firebase, so a launch with none waiting never loads
 * it.
 */
import type { KeyValueStorage } from './key-value-storage'

export const ACCEPTED_INVITES_STORAGE_KEY = 'card-scorekeeper:accepted-invites'

/** Bad data under our key reads as none waiting, never a crash. */
export function readAcceptedInvites(storage: KeyValueStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(ACCEPTED_INVITES_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function rememberAcceptedInvite(storage: KeyValueStorage, inviteId: string): void {
  const waiting = readAcceptedInvites(storage).filter((id) => id !== inviteId)
  storage.setItem(ACCEPTED_INVITES_STORAGE_KEY, JSON.stringify([...waiting, inviteId]))
}

export function forgetAcceptedInvite(storage: KeyValueStorage, inviteId: string): void {
  const waiting = readAcceptedInvites(storage).filter((id) => id !== inviteId)
  storage.setItem(ACCEPTED_INVITES_STORAGE_KEY, JSON.stringify(waiting))
}
