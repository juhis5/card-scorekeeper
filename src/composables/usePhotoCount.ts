/**
 * Client for the optional `/api/count` photo count: sends the ID token and a downscaled photo.
 * Never throws and never decides a score: every failure is a typed result, and the caller has the
 * player confirm the suggestion first.
 */
import { ref } from 'vue'
import { useImageDownscale } from './useImageDownscale'

const COUNT_ENDPOINT = '/api/count'
/** Long enough for a slow mobile upload plus Gemini, short enough to fall back to typing. */
const REQUEST_TIMEOUT_MS = 20_000

/** Mirrors api/_lib/types.ts's `ExtractedCard`. Not imported: client code never depends on api/. */
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
  // 502 is the function's "Gemini failed for good" (a bad key, a retired model): type the total.
  // 503 is a busy quota, which a retry can get past.
  502: 'server-error',
  503: 'unavailable',
  504: 'timeout',
}

function reasonForStatus(status: number): PhotoCountFailureReason {
  return REASON_BY_STATUS[status] ?? 'server-error'
}

export interface UsePhotoCountDeps {
  /** Defaults to the signed-in Firebase user's ID token; null when nobody is signed in. */
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

  /** Reads `file`'s cards for `roomCode`. Never throws. */
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
