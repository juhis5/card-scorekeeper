/**
 * The `/api/count` wire contract with the client. Separate from `src/lib/game/types.ts`, whose
 * `Card` is the validated domain shape (see `extraction.ts`).
 */

/** The caller's identity comes from the `Authorization` header, never from the body. */
export interface CountRequestBody {
  roomCode: string
  /** Base64-encoded image bytes, no `data:` URL prefix. */
  image: string
  mimeType: string
}

/** `value` is always recomputed on the server, never taken from the model. */
export interface ExtractedCard {
  rank: string
  suit: string | null
  value: number
}

/** A suggestion the player confirms or edits, never saved automatically. */
export interface CountResponseBody {
  cards: ExtractedCard[]
  total: number
}
