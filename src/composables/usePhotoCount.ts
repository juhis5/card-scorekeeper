/**
 * The `/api/count` client — the optional Gemini photo-count feature (see the vercel-gemini
 * skill). Gets the caller's Firebase ID token, downscales the photo (`useImageDownscale`), and
 * POSTs both to the room-gated serverless function.
 *
 * GRACEFUL BY CONSTRUCTION: every failure mode (no session, offline, a slow/hung request, a
 * 4xx/5xx, malformed JSON) collapses to a typed `PhotoCountResult` — this composable never
 * throws and never decides a score. The caller (a confirm/edit UI) always gets a chance to review
 * the suggestion before anything reaches `game.setRoundScore` (see docs/PLAN.md "Entering a
 * round's score" and CLAUDE.md's "photo card-count is a suggestion").
 *
 * Firebase is loaded lazily (dynamic `import()`), matching `useGameConnectivity`'s pattern — this
 * composable is only ever used from an already-online room, so the SDK is already loaded by then
 * in practice, but staying consistent costs nothing and keeps the pattern uniform across the app.
 */
import { ref } from 'vue'
import { useImageDownscale } from './useImageDownscale'

const COUNT_ENDPOINT = '/api/count'
/** A photo upload plus a Gemini call is a genuinely slow op (see the error-ux skill) — long
 * enough to cover a slow mobile-data upload, short enough that a hung request still fails into
 * "type it in" within a reasonable wait. */
const REQUEST_TIMEOUT_MS = 20_000

/** One detected card as returned by the function — mirrors api/_lib/types.ts's `ExtractedCard`
 * (the wire contract). Kept as its own type rather than imported from `api/`: the client bundle
 * must never depend on server-only code (see the vue-pinia skill's "dependencies point inward" —
 * `api/` is the one direction that may import from `src/`, never the reverse). */
export interface PhotoCountCard {
  rank: string
  suit: string | null
  value: number
}

export type PhotoCountFailureReason =
  | 'unauthenticated'
  | 'forbidden'
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'unavailable'
  | 'image-processing'
  | 'invalid-response'
  | 'server-error'

export type PhotoCountResult =
  | { ok: true; cards: PhotoCountCard[]; total: number }
  | { ok: false; reason: PhotoCountFailureReason }

function isPhotoCountCard(value: unknown): value is PhotoCountCard {
  if (typeof value !== 'object' || value === null) return false
  const { rank, suit, value: points } = value as Record<string, unknown>
  return (
    typeof rank === 'string' &&
    (suit === null || typeof suit === 'string') &&
    typeof points === 'number'
  )
}

async function parseSuccessBody(response: Response): Promise<PhotoCountResult> {
  let data: unknown
  try {
    data = await response.json()
  } catch {
    return { ok: false, reason: 'invalid-response' }
  }
  if (typeof data !== 'object' || data === null) return { ok: false, reason: 'invalid-response' }

  const { cards, total } = data as Record<string, unknown>
  if (!Array.isArray(cards) || typeof total !== 'number' || !cards.every(isPhotoCountCard)) {
    return { ok: false, reason: 'invalid-response' }
  }
  return { ok: true, cards, total }
}

/** Mirrors the statuses api/_lib/handler.ts returns, so the sheet can say what went wrong and
 * offer a retry only where one can help. */
const REASON_BY_STATUS: Readonly<Record<number, PhotoCountFailureReason>> = {
  401: 'unauthenticated',
  403: 'forbidden',
  413: 'image-processing',
  422: 'invalid-response',
  429: 'rate-limited',
  502: 'unavailable',
  503: 'unavailable',
  504: 'timeout',
}

function reasonForStatus(status: number): PhotoCountFailureReason {
  return REASON_BY_STATUS[status] ?? 'server-error'
}

export interface UsePhotoCountDeps {
  /** Defaults to the signed-in Firebase user's ID token, loaded lazily (see `lib/firebase.ts`) —
   * resolves `null` when nobody is signed in (never expected in an online room, but never
   * assumed). */
  getIdToken?: () => Promise<string | null>
  downscale?: (file: Blob) => Promise<{ base64: string; mimeType: string }>
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

async function defaultGetIdToken(): Promise<string | null> {
  const { getFirebaseAuth } = await import('@/lib/data/firebase')
  const user = getFirebaseAuth().currentUser
  return user ? user.getIdToken() : null
}

export function usePhotoCount(deps: UsePhotoCountDeps = {}) {
  const getIdToken = deps.getIdToken ?? defaultGetIdToken
  const downscale = deps.downscale ?? useImageDownscale().downscale
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS

  const isPending = ref(false)

  async function requestCount(roomCode: string, file: Blob): Promise<PhotoCountResult> {
    const idToken = await getIdToken().catch(() => null)
    if (!idToken) return { ok: false, reason: 'unauthenticated' }

    const image = await downscale(file).catch(() => null)
    if (!image) return { ok: false, reason: 'image-processing' }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(COUNT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ roomCode, image: image.base64, mimeType: image.mimeType }),
        signal: controller.signal,
      })
      if (!response.ok) return { ok: false, reason: reasonForStatus(response.status) }
      return await parseSuccessBody(response)
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError'
      return { ok: false, reason: isAbort ? 'timeout' : 'network' }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Reads `file`'s cards for `roomCode`. Never throws — see the file-level comment. */
  async function countCards(roomCode: string, file: Blob): Promise<PhotoCountResult> {
    isPending.value = true
    try {
      return await requestCount(roomCode, file)
    } finally {
      isPending.value = false
    }
  }

  return { isPending, countCards }
}
