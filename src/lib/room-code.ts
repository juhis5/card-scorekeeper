/**
 * Pure short room-code generator for the online multiplayer flow (see docs/PLAN.md
 * "Design notes for the room-code pattern"). No I/O, no Firestore — `FirestoreGameRepository`
 * calls this and, on the astronomically rare collision, calls it again.
 */

/** Unambiguous when read aloud or typed on a phone at a card table: no 0/O/1/I. */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export const ROOM_CODE_LENGTH = 5

export interface RoomCodeDeps {
  /** Returns a random integer in [0, maxExclusive). Defaults to `Math.random`-backed; inject a
   * fixed sequence in tests so room codes are deterministic (see the `tdd` skill). */
  randomInt?: (maxExclusive: number) => number
}

function defaultRandomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive)
}

/** Generates a fresh room code by drawing `ROOM_CODE_LENGTH` characters from the alphabet. */
export function generateRoomCode(deps: RoomCodeDeps = {}): string {
  const randomInt = deps.randomInt ?? defaultRandomInt
  let code = ''
  for (let position = 0; position < ROOM_CODE_LENGTH; position += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]
  }
  return code
}
