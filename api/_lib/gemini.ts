/**
 * The only module that touches the Gemini SDK — kept behind the `GeminiClient` interface so the
 * handler can be tested with a fake instead of a real API key/network call (see the tdd skill:
 * "mock the Gemini SDK — no live calls/creds").
 *
 * Model choice: `gemini-2.5-flash`, not a newer 3.x Flash generation — verified July 2026 that
 * Google's Gemini 3.x Flash models ignore/reject `temperature`/`top_p`/`top_k` entirely, which
 * would break the deterministic `temperature: 0` extraction this scored game relies on.
 * Re-verify at ai.google.dev/gemini-api/docs/models before ever bumping this.
 */
import { GoogleGenAI, Type, type Schema } from '@google/genai'

export const GEMINI_MODEL = 'gemini-2.5-flash'

/** The exact rank tokens `extraction.ts`'s `parseModelCards` accepts — kept as the one source of
 * truth for both the schema `enum` below and the prompt's token contract, so the two can't drift
 * out of sync with each other (they already independently have to match `src/lib/types.ts`'s
 * `Rank` union). */
const RANK_TOKENS = [
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
] as const

/** The extraction shape (docs/PLAN.md) as a Gemini response schema, forcing structured JSON
 * output. `rank` is constrained to an enum of the exact tokens the validator accepts (see
 * `extraction.ts`) — without this, a model free to write "King"/"Ace"/"Jack" would pass its own
 * schema but fail our validation on nearly every real hand. `suit` is nullable (a Joker has none)
 * rather than optional, so the model can't just omit it; left without its own enum (nullable +
 * enum is unreliable in this schema format), covered by the prompt's token list instead. This
 * constrains the model's OUTPUT SHAPE only — the actual values (rank/suit/value/total) are never
 * trusted as-is; the handler revalidates and recomputes them (see `extraction.ts`). */
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    cards: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          rank: { type: Type.STRING, format: 'enum', enum: [...RANK_TOKENS] },
          suit: { type: Type.STRING, nullable: true },
          value: { type: Type.NUMBER },
        },
        required: ['rank', 'suit', 'value'],
      },
    },
    total: { type: Type.NUMBER },
  },
  required: ['cards', 'total'],
}

/** Encodes the Rommi (Finnish Rummy) leftover-card values (see src/lib/rules.ts) so the model
 * reads photographed cards the same way manual entry scores them. The `rank` token contract is
 * spelled out explicitly (not just implied by "Jack, Queen, King...") — a model left to describe
 * cards in prose would write "King"/"Ace" and fail the schema/validator on nearly every hand. */
const PROMPT = `You are reading a photo of leftover playing cards at the end of a round of Finnish Rummy (Rommi). Identify every visible card and score it using these exact point values:
- Number cards 2-10 are worth their face value.
- Jack, Queen, and King are each worth 10.
- Ace is worth 15.
- Joker is worth 25 and has no suit.
For "rank", output EXACTLY one of these tokens: ${RANK_TOKENS.join(', ')} — use J, Q, K, A (never "Jack", "Queen", "King", "Ace" as words).
Return one entry per detected card with its rank, suit ("clubs", "diamonds", "hearts", "spades", or null for a Joker), and value, plus the summed total across all cards. The cards are laid flat and non-overlapping — count each one exactly once.`

export interface GeminiClient {
  /** Returns the model's raw response text (expected to be JSON per the response schema above) —
   * parsing/validating it is the handler's job (see `extraction.ts`'s `parseModelOutput`), so
   * this stays a thin passthrough. Rejects if the underlying API call fails (quota, network). */
  extractCards(image: string, mimeType: string): Promise<string>
}

export function createGeminiClient(apiKey: string): GeminiClient {
  const ai = new GoogleGenAI({ apiKey })
  return {
    async extractCards(image: string, mimeType: string): Promise<string> {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ inlineData: { mimeType, data: image } }, PROMPT],
        config: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      })
      return response.text ?? ''
    },
  }
}
