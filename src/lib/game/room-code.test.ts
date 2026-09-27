import { describe, expect, it } from 'vitest'
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from './room-code'

/** A `randomInt` that yields the given values in order. */
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

describe('normalizeRoomCode', () => {
  it('trims surrounding whitespace and upper-cases the input', () => {
    expect(normalizeRoomCode('  abcde ')).toBe('ABCDE')
  })
})

describe('isValidRoomCode', () => {
  it('accepts a code of the fixed length using only alphabet characters', () => {
    expect(isValidRoomCode('23456')).toBe(true)
  })

  it('rejects a code shorter than the fixed length', () => {
    expect(isValidRoomCode('2345')).toBe(false)
  })

  it('rejects a code longer than the fixed length', () => {
    expect(isValidRoomCode('234567')).toBe(false)
  })

  it('rejects a code containing a character outside the unambiguous alphabet', () => {
    expect(isValidRoomCode('AB0DE')).toBe(false)
  })

  it('rejects a lowercase code — callers must normalize before validating', () => {
    expect(isValidRoomCode('abcde')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidRoomCode('')).toBe(false)
  })
})
