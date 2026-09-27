/** Short room codes. On the rare collision FirestoreGameRepository just draws another. */

/** Unambiguous when read aloud or typed on a phone at a card table: no 0/O/1/I. */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export const ROOM_CODE_LENGTH = 5

/** Short-lived, so a leaked code stops working hours after its game. firestore.rules caps a room's
 * expiry at 7 hours. */
export const ROOM_TTL_MS = 6 * 60 * 60 * 1000

export interface RoomCodeDeps {
  /** A random integer in [0, maxExclusive). */
  randomInt?: (maxExclusive: number) => number
}

function defaultRandomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive)
}

export function generateRoomCode(deps: RoomCodeDeps = {}): string {
  const randomInt = deps.randomInt ?? defaultRandomInt
  let code = ''
  for (let position = 0; position < ROOM_CODE_LENGTH; position += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]
  }
  return code
}

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`)

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase()
}

/** Expects a normalized code: a lowercase one is rejected, not accepted. */
export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code)
}
