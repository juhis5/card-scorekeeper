/**
 * The real SDKs for `api/count.ts`, kept apart so no test imports code that needs credentials.
 * The rate-limit store is in memory, so the caps hold per warm instance, not across instances or
 * cold starts: accepted for a friends' game (docs/DECISIONS.md).
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
  // Up front, so a missing or malformed FIREBASE_SERVICE_ACCOUNT fails here as a logged 500, not
  // later inside token verification.
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
