/**
 * Request/response shapes for the `/api/count` photo-count function — the extraction shape from
 * docs/PLAN.md ("Extraction shape"). Kept separate from `src/lib/types.ts` (the app's domain
 * types): this module is the wire contract with the client, `src/lib/types.ts`'s `Card` is the
 * validated domain shape the two sides agree on internally (see `extraction.ts`).
 */

/** The parsed request body — caller identity comes from the `Authorization` header, never from
 * here (see docs/DECISIONS.md's 2026-07-24 ID-token gate entry). */
export interface CountRequestBody {
  roomCode: string
  /** Base64-encoded image bytes, no `data:` URL prefix. */
  image: string
  mimeType: string
}

/** One card as returned to the client — `value` is always server-recomputed, never trusted from
 * the model (see `extraction.ts`). */
export interface ExtractedCard {
  rank: string
  suit: string | null
  value: number
}

/** The response body: a suggestion for the UI to show + let the player confirm/edit, never
 * auto-committed (see the vercel-gemini skill). */
export interface CountResponseBody {
  cards: ExtractedCard[]
  total: number
}
