/**
 * The only module that touches the Gemini SDK, behind `GeminiClient` so the handler can be tested
 * with a fake.
 *
 * `GEMINI_MODEL` overrides the default, Google's pick for new projects (2.5 Flash refuses new
 * keys); check ai.google.dev/gemini-api/docs/models before changing it. Temperature stays at the
 * default, as Google advises for 3.x; the recompute and the player's confirm keep scores honest.
 */
import { GoogleGenAI, ThinkingLevel, Type, type Schema } from '@google/genai'
import { MAX_DETECTED_CARDS } from './extraction.js'

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'

/** Below the client's 20 s budget, which also covers the upload and a cold start. */
const GEMINI_TIMEOUT_MS = 15_000
/** A card list is short; the cap stops a looping response from running up output tokens. */
const MAX_OUTPUT_TOKENS = 2048

/** The rank tokens `parseModelCards` accepts, shared by the schema and the prompt so they can't
 * drift apart. Must match `Rank` in `src/lib/game/types.ts`. */
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

/** Forces structured JSON. `rank` is an enum of the exact tokens, or the model writes "King" and
 * fails validation on nearly every hand. `suit` is nullable (a Joker has none) rather than
 * optional, so it can't be omitted, and has no enum because nullable plus enum is unreliable here:
 * the prompt lists the suits. Only the shape is forced; the values are checked and recomputed. */
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    cards: {
      type: Type.ARRAY,
      maxItems: String(MAX_DETECTED_CARDS),
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

/** The card values from `src/lib/game/rules.ts`, so the model scores cards as manual entry does.
 * The rank tokens are spelled out, or the model writes "King" and "Ace". Without the multi-deck
 * line, it merges two identical 7♥ into one. */
const PROMPT = `You are reading a photo of leftover playing cards at the end of a round of Finnish Rummy (Rommi). Identify every visible card and score it using these exact point values:
- Number cards 2-9 are worth 5 points each. 10 is worth 10.
- Jack, Queen, and King are each worth 10.
- Ace is worth 15.
- Joker is worth 25 and has no suit.
For "rank", output EXACTLY one of these tokens: ${RANK_TOKENS.join(', ')} — use J, Q, K, A (never "Jack", "Queen", "King", "Ace" as words).
The game is played with two or three decks shuffled together, so the same card (same rank AND suit) can appear more than once, and there can be several Jokers. Every physical card is its own entry — never merge identical-looking cards into one.
Return one entry per detected card with its rank, suit ("clubs", "diamonds", "hearts", "spades", or null for a Joker), and value, plus the summed total across all cards. The cards are laid flat and non-overlapping — count each physical card exactly once.`

export interface GeminiClient {
  /** The model's raw text, for the handler to parse. Rejects if the call fails (quota, network). */
  extractCards(image: string, mimeType: string): Promise<string>
}

export function createGeminiClient(apiKey: string, model: string): GeminiClient {
  const ai = new GoogleGenAI({ apiKey })
  return {
    async extractCards(image: string, mimeType: string): Promise<string> {
      const response = await ai.models.generateContent({
        model,
        contents: [{ inlineData: { mimeType, data: image } }, PROMPT],
        config: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          // Reading cards is recognition, not reasoning: low thinking keeps it fast.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          abortSignal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        },
      })
      return response.text ?? ''
    },
  }
}
