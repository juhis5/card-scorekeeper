/**
 * The online room this device was last in, so Home can offer "Continue game" after a reload or a
 * trip back to Home. Remembered when a room is created or joined, forgotten when that game
 * finishes or this device loses its seat, and ignored once the room would have expired.
 *
 * Best-effort like every other local persistence here: storage can be unavailable (some private
 * windows), and then there is simply nothing to continue.
 */
import { browserLocalStorage, type KeyValueStorage } from './key-value-storage'
import { ROOM_TTL_MS } from '../game/room-code'

const LAST_ROOM_KEY = 'card-scorekeeper:last-room'

export interface LastRoomDeps {
  storage?: KeyValueStorage
  now?: () => number
}

interface RememberedRoom {
  code: string
  savedAtMs: number
}

function isRememberedRoom(value: unknown): value is RememberedRoom {
  if (typeof value !== 'object' || value === null) return false
  const { code, savedAtMs } = value as Record<string, unknown>
  return typeof code === 'string' && typeof savedAtMs === 'number'
}

function readRemembered(storage: KeyValueStorage): RememberedRoom | null {
  try {
    const raw = storage.getItem(LAST_ROOM_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isRememberedRoom(parsed) ? parsed : null
  } catch {
    return null
  }
}

function write(storage: KeyValueStorage, value: string): void {
  try {
    storage.setItem(LAST_ROOM_KEY, value)
  } catch {
    // Storage unavailable: there will just be no "Continue game" for this room.
  }
}

export function rememberRoom(code: string, deps: LastRoomDeps = {}): void {
  const storage = deps.storage ?? browserLocalStorage()
  const now = deps.now ?? Date.now
  write(storage, JSON.stringify({ code, savedAtMs: now() } satisfies RememberedRoom))
}

/** The remembered room's code, or null when there is none or it would have expired. */
export function lastRoom(deps: LastRoomDeps = {}): string | null {
  const storage = deps.storage ?? browserLocalStorage()
  const now = deps.now ?? Date.now
  const remembered = readRemembered(storage)
  if (!remembered || now() - remembered.savedAtMs >= ROOM_TTL_MS) return null
  return remembered.code
}

/** Forgets `code` only if it is still the remembered room, so an old game can't clear a newer one. */
export function forgetRoom(code: string, deps: LastRoomDeps = {}): void {
  const storage = deps.storage ?? browserLocalStorage()
  if (readRemembered(storage)?.code === code) write(storage, '')
}
