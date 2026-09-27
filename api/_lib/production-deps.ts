/**
 * Wires the real SDKs into `CountHandlerDeps` for the actual deployed function — `api/count.ts`
 * is the only caller. Kept separate from `handler.ts` so every other module stays test-fakeable
 * (see the tdd skill) without this file's real-credential requirements ever being imported by a
 * test.
 *
 * KNOWN LIMITATION (see the rate-limit.ts doc comment and the handoff notes): `rateLimitStore`
 * below is the in-memory implementation. It only bounds calls within a single warm Vercel
 * instance — the per-room and, especially, the GLOBAL cap are not real ceilings across Vercel's
 * horizontally-scaled/cold-started instances until this is swapped for a Vercel KV/Upstash-backed
 * `RateLimitStore`. Not built in this slice (out of scope — "don't require live KV"); flagged
 * here and in the handoff so it isn't mistaken for a real production guarantee.
 */
import { createGeminiClient } from './gemini.js'
import { getRoomSnapshot, verifyIdToken } from './firebase-admin.js'
import { InMemoryRateLimitStore } from './rate-limit.js'
import type { CountHandlerDeps } from './handler.js'

// Module-scoped, so it's reused across warm invocations of the same instance (see the doc
// comment above for why that's still not a real cross-instance cap).
const rateLimitStore = new InMemoryRateLimitStore()

export function createProductionDeps(): CountHandlerDeps {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set')
  }

  return {
    verifyIdToken,
    getRoomSnapshot,
    rateLimitStore,
    geminiClient: createGeminiClient(apiKey),
    now: () => Date.now(),
  }
}
