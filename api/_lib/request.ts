/**
 * Pure request-shape validation — no SDKs, no I/O. Kept separate from the handler so every
 * malformed-input case is a plain unit test (see the tdd skill).
 */
import type { CountRequestBody } from './types'

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Validates and narrows an unknown request body into `CountRequestBody`, or returns null if any
 * field is missing/wrong-typed. Accepts either an already-parsed object (the common case — the
 * Vercel Node runtime pre-parses JSON bodies) or a raw JSON string, for robustness across runtime
 * versions.
 */
export function parseCountRequestBody(rawBody: unknown): CountRequestBody | null {
  const body = typeof rawBody === 'string' ? tryParseJson(rawBody) : rawBody
  if (typeof body !== 'object' || body === null) return null

  const { roomCode, image, mimeType } = body as Record<string, unknown>
  if (typeof roomCode !== 'string' || roomCode.length === 0) return null
  if (typeof image !== 'string' || image.length === 0) return null
  if (typeof mimeType !== 'string' || !mimeType.startsWith('image/')) return null

  return { roomCode, image, mimeType }
}

/** Extracts the bearer token from an `Authorization` header value, or null if absent/malformed.
 * Node/Vercel lowercase header names and may present a repeated header as a string array — the
 * caller passes whichever value it finds under `authorization`. */
export function parseBearerToken(headerValue: string | string[] | undefined): string | null {
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!value) return null
  const match = /^Bearer\s+(.+)$/i.exec(value)
  const token = match?.[1]?.trim()
  return token && token.length > 0 ? token : null
}
