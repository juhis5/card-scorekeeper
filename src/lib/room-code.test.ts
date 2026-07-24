import { describe, expect, it } from 'vitest'
import { generateRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './room-code'

/** Returns a `randomInt` that always yields the next value from a fixed sequence. */
function sequenceOf(...indices: number[]): (maxExclusive: number) => number {
  let call = 0
  return () => {
    const index = indices[call] ?? 0
    call += 1
    return index
  }
}

describe('ROOM_CODE_ALPHABET', () => {
  it('excludes visually ambiguous characters 0, O, 1, and I', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[0O1I]/)
  })

  it('has no duplicate characters', () => {
    expect(new Set(ROOM_CODE_ALPHABET.split('')).size).toBe(ROOM_CODE_ALPHABET.length)
  })
})

describe('generateRoomCode', () => {
  it('generates a code of the fixed room-code length', () => {
    const code = generateRoomCode()

    expect(code).toHaveLength(ROOM_CODE_LENGTH)
  })

  it('only uses characters from the unambiguous alphabet', () => {
    const code = generateRoomCode()

    expect([...code].every((char) => ROOM_CODE_ALPHABET.includes(char))).toBe(true)
  })

  it('maps each injected random index to the alphabet character at that index', () => {
    const first = ROOM_CODE_ALPHABET[0]
    const second = ROOM_CODE_ALPHABET[1]
    const randomInt = sequenceOf(0, 1, 0, 1, 0)

    const code = generateRoomCode({ randomInt })

    expect(code).toBe([first, second, first, second, first].join(''))
  })

  it('calls the injected randomInt once per character, with the alphabet length as the bound', () => {
    const calls: number[] = []
    const randomInt = (maxExclusive: number) => {
      calls.push(maxExclusive)
      return 0
    }

    generateRoomCode({ randomInt })

    expect(calls).toEqual(Array(ROOM_CODE_LENGTH).fill(ROOM_CODE_ALPHABET.length))
  })

  it('is deterministic for a given injected randomInt, so tests never depend on real randomness', () => {
    const randomInt = sequenceOf(3, 3, 3, 3, 3)

    const first = generateRoomCode({ randomInt })
    const second = generateRoomCode({ randomInt: sequenceOf(3, 3, 3, 3, 3) })

    expect(first).toBe(second)
  })
})
