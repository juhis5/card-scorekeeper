/**
 * Pure short room-code generator for the online multiplayer flow (see docs/PLAN.md
 * "Design notes for the room-code pattern"). No I/O, no Firestore — `FirestoreGameRepository`
 * calls this and, on the astronomically rare collision, calls it again.
 */

/** Unambiguous when read aloud or typed on a phone at a card table: no 0/O/1/I. */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export const ROOM_CODE_LENGTH = 5

/** Rooms are short-lived by design (see docs/PLAN.md "Protecting your Gemini free tier"): a
 * leaked room code stops working a few hours after the game that used it. firestore.rules caps
 * a room's expiry at 7 hours. */
export const ROOM_TTL_MS = 6 * 60 * 60 * 1000

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

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`)

/** Trims and upper-cases user-typed input so a join attempt tolerates how people actually type a
 * code on a phone (lowercase, stray whitespace) before it's validated or sent anywhere. */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase()
}

/** Checks a room code against the fixed length + unambiguous alphabet — client-side, before
 * ever calling the backend (see the error-ux skill: validate format before the network round
 * trip). Expects an already-`normalizeRoomCode`d value; a lowercase code is rejected here, not
 * silently accepted. */
export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code)
}
