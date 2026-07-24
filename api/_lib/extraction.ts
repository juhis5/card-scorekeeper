/**
 * Validates the Gemini model's raw output against the extraction shape and recomputes every
 * value server-side — a bad or adversarial model sum must not slip through (see docs/PLAN.md
 * "Response handling & accuracy" and the vercel-gemini skill).
 *
 * Imports `cardValue`/`roundTotal` directly from `src/lib/rules.ts` rather than mirroring them:
 * `rules.ts` has zero Vue/browser dependencies (pure functions over `src/lib/types.ts`), so it
 * resolves cleanly here — the recompute is *the same code* the manual-entry path and the rest of
 * the app use, not a copy that could drift out of parity.
 */
import { cardValue, roundTotal } from '../../src/lib/rules'
import type { Card, Rank, Suit } from '../../src/lib/types'
import type { CountResponseBody } from './types'

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

function toCard(raw: unknown): Card | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { rank, suit } = raw as Record<string, unknown>
  if (typeof rank !== 'string' || !VALID_RANKS.has(rank)) return null

  if (rank === 'Joker') {
    // The model is prompted to send suit: null for a Joker (see gemini.ts) — undefined is
    // tolerated too (a lenient model omitting a null field), anything else is malformed.
    if (suit !== null && suit !== undefined) return null
    return { rank: 'Joker', suit: null }
  }

  if (typeof suit !== 'string' || !VALID_SUITS.has(suit)) return null
  return { rank: rank as Exclude<Rank, 'Joker'>, suit: suit as Suit }
}

/**
 * Validates the model's already-parsed JSON against the extraction shape (a `{ cards: [...] }`
 * object with a non-empty array of recognizable cards) and returns the parsed domain `Card[]`, or
 * null if anything is missing/wrong-typed/unrecognized. Deliberately ignores the model's own
 * `value`/`total` fields — those are never trusted, only recomputed (see `buildExtractionResult`).
 */
export function parseModelCards(raw: unknown): Card[] | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { cards } = raw as Record<string, unknown>
  if (!Array.isArray(cards) || cards.length === 0) return null

  const parsed: Card[] = []
  for (const rawCard of cards) {
    const card = toCard(rawCard)
    if (!card) return null
    parsed.push(card)
  }
  return parsed
}

/**
 * Parses the model's raw response text end-to-end: JSON parse + shape validation, collapsed into
 * one null-on-any-failure result. Bad JSON and a well-formed-but-wrong shape are the same failure
 * from the handler's point of view ("malformed model output → clean error, UI falls back to
 * manual") — they get the same status code, so they're validated in the same place.
 */
export function parseModelOutput(rawText: string): Card[] | null {
  let json: unknown
  try {
    json = JSON.parse(rawText)
  } catch {
    return null
  }
  return parseModelCards(json)
}

/** Builds the final response from validated cards, recomputing every value server-side from the
 * SAME rules manual entry uses — never the model's stated per-card value or total. */
export function buildExtractionResult(cards: Card[]): CountResponseBody {
  return {
    cards: cards.map((card) => ({ rank: card.rank, suit: card.suit, value: cardValue(card) })),
    total: roundTotal(cards),
  }
}
