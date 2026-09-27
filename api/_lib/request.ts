/**
 * Pure request-shape validation — no SDKs, no I/O. Kept separate from the handler so every
 * malformed-input case is a plain unit test (see the tdd skill).
 */
import { isValidRoomCode } from '../../src/lib/room-code.js'
import type { CountRequestBody } from './types.js'

/** The formats phone cameras and galleries produce. Anything else (SVG, arbitrary types) is
 * rejected before it can reach Gemini. */
const ACCEPTED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

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
  // A strict room code, not just a string: the Admin SDK builds `room/${roomCode}` paths with
  // rules bypassed, so a "/" in it could otherwise pick a different document to read.
  if (typeof roomCode !== 'string' || !isValidRoomCode(roomCode)) return null
  if (typeof image !== 'string' || !BASE64_PATTERN.test(image)) return null
  if (typeof mimeType !== 'string' || !ACCEPTED_IMAGE_TYPES.has(mimeType)) return null

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
