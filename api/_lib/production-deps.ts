/**
 * Wires the real SDKs into `CountHandlerDeps` for the actual deployed function — `api/count.ts`
 * is the only caller. Kept separate from `handler.ts` so every other module stays test-fakeable
 * (see the tdd skill) without this file's real-credential requirements ever being imported by a
 * test.
 *
 * `rateLimitStore` is in memory, so the per-room and global caps hold per warm instance, not
 * across instances or cold starts. Accepted by the owner for a friends' game (docs/DECISIONS.md,
 * review round 5); see rate-limit.ts.
 */
import { createGeminiClient, DEFAULT_GEMINI_MODEL } from './gemini.js'
import { getAdminApp, getRoomSnapshot, verifyIdToken } from './firebase-admin.js'
import { InMemoryRateLimitStore } from './rate-limit.js'
import type { CountHandlerDeps } from './handler.js'

// Module-scoped, so warm invocations of the same instance share it.
const rateLimitStore = new InMemoryRateLimitStore()

export function createProductionDeps(): CountHandlerDeps {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set')
  }
  // Up front, so a missing or malformed FIREBASE_SERVICE_ACCOUNT fails as a logged 500 here
  // instead of surfacing later inside token verification.
  getAdminApp()
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL

  return {
    verifyIdToken,
    getRoomSnapshot,
    rateLimitStore,
    geminiClient: createGeminiClient(apiKey, model),
    now: () => Date.now(),
  }
}
