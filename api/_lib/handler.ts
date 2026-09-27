/**
 * Orchestrates the `/api/count` request: wires the pure gate/rate-limit/extraction logic plus the
 * two SDK boundaries (`verifyIdToken`/`getRoomSnapshot` from the Admin SDK, `geminiClient` from
 * the Gemini SDK) together. Every dependency is injected via `CountHandlerDeps`, so this whole
 * function is unit-testable with fakes — no real Firebase project or Gemini API key needed (see
 * the tdd skill). `api/count.ts` is the thin Vercel adapter that wires the real SDKs and calls
 * this.
 *
 * Gate order (cheapest checks first, per the vercel-gemini skill's "layered protection"):
 *   1. method + request shape (no I/O)               → 405 / 400
 *   2. image size cap (no I/O)                         → 413
 *   3. Firebase ID token (Admin SDK verify)            → 401
 *   4. room exists/active + caller is a member         → 403
 *   5. per-room, then global rate limit                → 429
 *   6. Gemini call (timeout / busy / other)            → 504 / 503 / 502
 *   7. model output validation                         → 422
 *   8. success — server-recomputed cards + total       → 200
 */
import { parseBearerToken, parseCountRequestBody } from './request.js'
import { authenticateRequest, evaluateRoomGate, type RoomSnapshot } from './gate.js'
import { checkRateLimit, type RateLimitConfig, type RateLimitStore } from './rate-limit.js'
import { exceedsSizeCap } from './image.js'
import { parseModelOutput, buildExtractionResult } from './extraction.js'
import type { GeminiClient } from './gemini.js'
import { logServerError } from './log.js'
import type { CountResponseBody } from './types.js'

/** A hand-count happens a few times per round; 30 calls per 15 minutes comfortably covers every
 * player photographing their hand every round of a single game, without leaving headroom for
 * draining the shared free-tier quota (see docs/PLAN.md "Protecting your Gemini free tier"). */
const PER_ROOM_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60 * 1000, maxRequests: 30 }

/** Backstop across every room so nobody beats the per-room cap by spinning up many fake rooms. */
const GLOBAL_RATE_LIMIT: RateLimitConfig = { windowMs: 60 * 60 * 1000, maxRequests: 300 }
const GLOBAL_RATE_LIMIT_KEY = 'global'

/** Minimal request shape this handler needs — deliberately not `@vercel/node`'s `VercelRequest`,
 * so tests can pass plain objects. The real Vercel Node runtime provides exactly this shape
 * (pre-parsed JSON `body`, lower-cased `headers`) without needing that package. */
export interface CountApiRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

export interface CountApiResult {
  status: number
  body: CountResponseBody | { error: string }
}

export interface CountHandlerDeps {
  verifyIdToken: (idToken: string) => Promise<{ uid: string }>
  getRoomSnapshot: (roomCode: string, uid: string) => Promise<RoomSnapshot>
  rateLimitStore: RateLimitStore
  geminiClient: GeminiClient
  /** Injected clock — deterministic tests for the rate-limit/room-expiry checks. */
  now: () => number
}

export async function handleCountRequest(
  req: CountApiRequest,
  deps: CountHandlerDeps,
): Promise<CountApiResult> {
  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'method_not_allowed' } }
  }

  const parsedBody = parseCountRequestBody(req.body)
  if (!parsedBody) {
    return { status: 400, body: { error: 'invalid_request' } }
  }
  // Before any I/O: an oversized body must cost no auth call, Firestore read or rate-limit slot.
  if (exceedsSizeCap(parsedBody.image)) {
    return { status: 413, body: { error: 'image_too_large' } }
  }

  const token = parseBearerToken(req.headers.authorization)
  const authResult = await authenticateRequest(token, deps.verifyIdToken)
  if (!authResult.ok) {
    return { status: 401, body: { error: 'unauthenticated' } }
  }

  const nowMs = deps.now()
  const room = await deps.getRoomSnapshot(parsedBody.roomCode, authResult.uid)
  const gateResult = evaluateRoomGate(room, nowMs)
  if (!gateResult.ok) {
    return { status: 403, body: { error: `room_${gateResult.reason}` } }
  }

  const perRoomAllowed = await checkRateLimit(
    deps.rateLimitStore,
    `room:${parsedBody.roomCode}`,
    PER_ROOM_RATE_LIMIT,
    nowMs,
  )
  if (!perRoomAllowed) {
    return { status: 429, body: { error: 'room_rate_limited' } }
  }

  const globalAllowed = await checkRateLimit(
    deps.rateLimitStore,
    GLOBAL_RATE_LIMIT_KEY,
    GLOBAL_RATE_LIMIT,
    nowMs,
  )
  if (!globalAllowed) {
    return { status: 429, body: { error: 'global_rate_limited' } }
  }

  let rawText: string
  try {
    rawText = await deps.geminiClient.extractCards(parsedBody.image, parsedBody.mimeType)
  } catch (error) {
    logServerError('gemini call', error)
    return geminiFailureResult(error)
  }

  const cards = parseModelOutput(rawText)
  if (!cards) {
    return { status: 422, body: { error: 'malformed_model_output' } }
  }

  return { status: 200, body: buildExtractionResult(cards) }
}

/** Maps an upstream Gemini failure to a status the client can act on: a timeout or a busy quota
 * is worth retrying later, anything else means "type your total". */
function geminiFailureResult(error: unknown): CountApiResult {
  const failure = typeof error === 'object' && error !== null ? error : {}
  const { name, status, message } = failure as {
    name?: unknown
    status?: unknown
    message?: unknown
  }
  if (name === 'AbortError' || name === 'TimeoutError') {
    return { status: 504, body: { error: 'model_timeout' } }
  }
  if (status === 429 || (typeof message === 'string' && message.includes('RESOURCE_EXHAUSTED'))) {
    return { status: 503, body: { error: 'model_busy' } }
  }
  return { status: 502, body: { error: 'model_unavailable' } }
}
