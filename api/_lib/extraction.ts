/**
 * Validates the model's output and recomputes every value with the app's own rules.ts (the same
 * code manual entry uses, not a copy), so a bad or adversarial model sum can't slip through.
 */
import { cardValue, roundTotal } from '../../src/lib/game/rules.js'
import type { Card, Rank, Suit } from '../../src/lib/game/types.js'
import type { CountResponseBody } from './types.js'

const VALID_RANKS: ReadonlySet<string> = new Set([
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
  'Joker',
])

const VALID_SUITS: ReadonlySet<string> = new Set(['clubs', 'diamonds', 'hearts', 'spades'])

/** More than three decks' worth of leftovers could never be one hand; a longer list means the
 * model is looping, so it's rejected rather than scored. */
export const MAX_DETECTED_CARDS = 60

function toCard(raw: unknown): Card | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { rank, suit } = raw as Record<string, unknown>
  if (typeof rank !== 'string' || !VALID_RANKS.has(rank)) return null

  if (rank === 'Joker') {
    // The prompt asks for suit: null on a Joker. An omitted suit is tolerated too.
    if (suit !== null && suit !== undefined) return null
    return { rank: 'Joker', suit: null }
  }

  if (typeof suit !== 'string' || !VALID_SUITS.has(suit)) return null
  return { rank: rank as Exclude<Rank, 'Joker'>, suit: suit as Suit }
}

/** `{ cards: [...] }` with a non-empty list of recognized cards, as `Card[]`, or null. The model's
 * own `value` and `total` are ignored: they're only ever recomputed. */
export function parseModelCards(raw: unknown): Card[] | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { cards } = raw as Record<string, unknown>
  if (!Array.isArray(cards) || cards.length === 0 || cards.length > MAX_DETECTED_CARDS) return null

  const parsed: Card[] = []
  for (const rawCard of cards) {
    const card = toCard(rawCard)
    if (!card) return null
    parsed.push(card)
  }
  return parsed
}

/** JSON parse plus shape check. Bad JSON and a wrong shape are the same failure to the handler,
 * so both return null. */
export function parseModelOutput(rawText: string): Card[] | null {
  let json: unknown
  try {
    json = JSON.parse(rawText)
  } catch {
    return null
  }
  return parseModelCards(json)
}

/** The response, with every value recomputed from the rules, never taken from the model. */
export function buildExtractionResult(cards: Card[]): CountResponseBody {
  return {
    cards: cards.map((card) => ({ rank: card.rank, suit: card.suit, value: cardValue(card) })),
    total: roundTotal(cards),
  }
}
