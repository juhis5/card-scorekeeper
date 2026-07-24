// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildExtractionResult, parseModelCards, parseModelOutput } from './extraction'

describe('parseModelCards', () => {
  it('parses a well-formed cards array', () => {
    const raw = {
      cards: [
        { rank: '4', suit: 'diamonds', value: 4 },
        { rank: 'K', suit: 'spades', value: 10 },
        { rank: 'A', suit: 'hearts', value: 15 },
        { rank: 'Joker', suit: null, value: 25 },
      ],
    }
    expect(parseModelCards(raw)).toEqual([
      { rank: '4', suit: 'diamonds' },
      { rank: 'K', suit: 'spades' },
      { rank: 'A', suit: 'hearts' },
      { rank: 'Joker', suit: null },
    ])
  })

  it('tolerates an omitted (rather than null) suit on a Joker', () => {
    const raw = { cards: [{ rank: 'Joker', value: 25 }] }
    expect(parseModelCards(raw)).toEqual([{ rank: 'Joker', suit: null }])
  })

  it('rejects a non-object payload', () => {
    expect(parseModelCards('nope')).toBeNull()
    expect(parseModelCards(null)).toBeNull()
  })

  it('rejects a payload with no cards array', () => {
    expect(parseModelCards({ total: 4 })).toBeNull()
  })

  it('rejects an empty cards array', () => {
    expect(parseModelCards({ cards: [] })).toBeNull()
  })

  it('rejects an unrecognized rank', () => {
    expect(parseModelCards({ cards: [{ rank: '11', suit: 'clubs', value: 11 }] })).toBeNull()
  })

  it('rejects an unrecognized suit', () => {
    expect(parseModelCards({ cards: [{ rank: '4', suit: 'stars', value: 4 }] })).toBeNull()
  })

  it('rejects a non-Joker card with a null suit', () => {
    expect(parseModelCards({ cards: [{ rank: '4', suit: null, value: 4 }] })).toBeNull()
  })

  it('rejects a Joker with a non-null suit', () => {
    expect(parseModelCards({ cards: [{ rank: 'Joker', suit: 'clubs', value: 25 }] })).toBeNull()
  })

  it('rejects the whole batch if any single card is malformed', () => {
    const raw = {
      cards: [
        { rank: '4', suit: 'diamonds', value: 4 },
        { rank: 'not-a-rank', suit: 'clubs', value: 1 },
      ],
    }
    expect(parseModelCards(raw)).toBeNull()
  })
})

describe('parseModelOutput', () => {
  it('parses valid JSON text into cards', () => {
    const text = JSON.stringify({ cards: [{ rank: '4', suit: 'diamonds', value: 4 }] })
    expect(parseModelOutput(text)).toEqual([{ rank: '4', suit: 'diamonds' }])
  })

  it('returns null for unparseable JSON text', () => {
    expect(parseModelOutput('{not json')).toBeNull()
  })

  it('returns null for valid JSON that fails shape validation', () => {
    expect(parseModelOutput(JSON.stringify({ foo: 'bar' }))).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseModelOutput('')).toBeNull()
  })
})

describe('buildExtractionResult', () => {
  it('recomputes each value and the total using the shared rules.ts values', () => {
    const cards = [
      { rank: '4' as const, suit: 'diamonds' as const },
      { rank: 'K' as const, suit: 'spades' as const },
      { rank: 'A' as const, suit: 'hearts' as const },
      { rank: 'Joker' as const, suit: null },
    ]
    expect(buildExtractionResult(cards)).toEqual({
      cards: [
        { rank: '4', suit: 'diamonds', value: 4 },
        { rank: 'K', suit: 'spades', value: 10 },
        { rank: 'A', suit: 'hearts', value: 15 },
        { rank: 'Joker', suit: null, value: 25 },
      ],
      total: 54,
    })
  })

  it('ignores a per-card value the caller might have attached and recomputes from rank alone', () => {
    // parseModelCards never keeps a model-supplied `value` in the first place, but this pins the
    // recompute contract directly: buildExtractionResult only ever trusts rank/suit.
    const cards = [{ rank: '2' as const, suit: 'clubs' as const }]
    expect(buildExtractionResult(cards).cards[0]).toEqual({ rank: '2', suit: 'clubs', value: 2 })
  })
})
