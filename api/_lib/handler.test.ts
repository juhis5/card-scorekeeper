// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { handleCountRequest, type CountApiRequest, type CountHandlerDeps } from './handler'
import { InMemoryRateLimitStore } from './rate-limit'
import { MAX_IMAGE_BYTES } from './image'
import type { RoomSnapshot } from './gate'

const ACTIVE_ROOM: RoomSnapshot = {
  exists: true,
  status: 'playing',
  expiresAtMs: 2000,
  isMember: true,
}

const VALID_MODEL_OUTPUT = JSON.stringify({
  cards: [{ rank: '4', suit: 'diamonds', value: 5 }],
  total: 5,
})

function createDeps(overrides: Partial<CountHandlerDeps> = {}): CountHandlerDeps {
  return {
    verifyIdToken: vi.fn().mockResolvedValue({ uid: 'player-1' }),
    getRoomSnapshot: vi.fn().mockResolvedValue(ACTIVE_ROOM),
    rateLimitStore: new InMemoryRateLimitStore(),
    geminiClient: { extractCards: vi.fn().mockResolvedValue(VALID_MODEL_OUTPUT) },
    now: () => 1000,
    ...overrides,
  }
}

/** A well-formed body; a test overrides the field it's about. */
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    roomCode: 'ABCDE',
    image: Buffer.from('a tiny fake image').toString('base64'),
    mimeType: 'image/jpeg',
    ...overrides,
  }
}

function validRequest(overrides: Partial<CountApiRequest> = {}): CountApiRequest {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer a-valid-token' },
    body: validBody(),
    ...overrides,
  }
}

describe('handleCountRequest', () => {
  it('returns 200 with server-recomputed cards + total on a valid request', async () => {
    const deps = createDeps()
    const result = await handleCountRequest(validRequest(), deps)

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ cards: [{ rank: '4', suit: 'diamonds', value: 5 }], total: 5 })
    expect(deps.getRoomSnapshot).toHaveBeenCalledWith('ABCDE', 'player-1')
  })

  it('rejects a non-POST method with 405', async () => {
    const result = await handleCountRequest(validRequest({ method: 'GET' }), createDeps())
    expect(result.status).toBe(405)
  })

  it('rejects a malformed request body with 400', async () => {
    const result = await handleCountRequest(validRequest({ body: {} }), createDeps())
    expect(result.status).toBe(400)
  })

  it('rejects a request with no Authorization header with 401', async () => {
    const result = await handleCountRequest(validRequest({ headers: {} }), createDeps())
    expect(result.status).toBe(401)
  })

  it('rejects a request whose ID token the Admin SDK rejects with 401', async () => {
    const deps = createDeps({
      verifyIdToken: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('bad token'), { code: 'auth/argument-error' })),
    })
    const result = await handleCountRequest(validRequest(), deps)
    expect(result.status).toBe(401)
  })

  it.each([
    [
      'a room that does not exist',
      { exists: false, status: null, expiresAtMs: null, isMember: false } satisfies RoomSnapshot,
    ],
    ['a finished room', { ...ACTIVE_ROOM, status: 'finished' } satisfies RoomSnapshot],
    ['an expired room', { ...ACTIVE_ROOM, expiresAtMs: 500 } satisfies RoomSnapshot],
    [
      'a room the caller is not seated in',
      { ...ACTIVE_ROOM, isMember: false } satisfies RoomSnapshot,
    ],
  ])('rejects %s with 403', async (_label, roomSnapshot) => {
    const deps = createDeps({ getRoomSnapshot: vi.fn().mockResolvedValue(roomSnapshot) })
    const result = await handleCountRequest(validRequest(), deps)
    expect(result.status).toBe(403)
  })

  it('rejects once the per-room rate limit is exhausted with 429', async () => {
    const store = new InMemoryRateLimitStore()
    await store.set('room:ABCDE', { count: 30, windowStartMs: 1000 })
    const deps = createDeps({ rateLimitStore: store })

    const result = await handleCountRequest(validRequest(), deps)
    expect(result.status).toBe(429)
    expect(result.body).toEqual({ error: 'room_rate_limited' })
  })

  it('rejects once the global rate limit is exhausted even with per-room budget left, 429', async () => {
    const store = new InMemoryRateLimitStore()
    await store.set('global', { count: 300, windowStartMs: 1000 })
    const deps = createDeps({ rateLimitStore: store })

    const result = await handleCountRequest(validRequest(), deps)
    expect(result.status).toBe(429)
    expect(result.body).toEqual({ error: 'global_rate_limited' })
  })

  it('rejects an oversized image before any network call, so it costs no quota or rate limit', async () => {
    const deps = createDeps()
    const oversizedImage = Buffer.alloc(MAX_IMAGE_BYTES + 1, 1).toString('base64')

    const result = await handleCountRequest(
      validRequest({ body: validBody({ image: oversizedImage }) }),
      deps,
    )

    expect(result.status).toBe(413)
    expect(deps.verifyIdToken).not.toHaveBeenCalled()
    expect(deps.getRoomSnapshot).not.toHaveBeenCalled()
  })

  it('reports a Gemini call that hits its deadline as a 504 timeout', async () => {
    const deps = createDeps({
      geminiClient: {
        extractCards: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      },
    })

    const result = await handleCountRequest(validRequest(), deps)

    expect(result).toEqual({ status: 504, body: { error: 'model_timeout' } })
  })

  it('reports an exhausted Gemini quota as 503, distinct from other upstream failures', async () => {
    const deps = createDeps({
      geminiClient: {
        extractCards: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 })),
      },
    })

    const result = await handleCountRequest(validRequest(), deps)

    expect(result).toEqual({ status: 503, body: { error: 'model_busy' } })
  })

  it('lets a server-side failure while verifying the token surface as an error, not a 401', async () => {
    const deps = createDeps({
      verifyIdToken: vi.fn().mockRejectedValue(new Error('FIREBASE_SERVICE_ACCOUNT is not set')),
    })

    await expect(handleCountRequest(validRequest(), deps)).rejects.toThrow(
      'FIREBASE_SERVICE_ACCOUNT is not set',
    )
  })

  it('returns a clean error when the Gemini call itself fails (quota/network)', async () => {
    const deps = createDeps({
      geminiClient: { extractCards: vi.fn().mockRejectedValue(new Error('quota exceeded')) },
    })
    const result = await handleCountRequest(validRequest(), deps)
    expect(result.status).toBe(502)
  })

  it('reports a Gemini client that throws a non-Error value as 502 model_unavailable', async () => {
    const deps = createDeps({
      geminiClient: { extractCards: vi.fn().mockRejectedValue('socket hang up') },
    })
    const result = await handleCountRequest(validRequest(), deps)
    expect(result).toEqual({ status: 502, body: { error: 'model_unavailable' } })
  })

  it('returns a clean error for malformed model output', async () => {
    const deps = createDeps({
      geminiClient: { extractCards: vi.fn().mockResolvedValue('not valid json') },
    })
    const result = await handleCountRequest(validRequest(), deps)
    expect(result.status).toBe(422)
  })

  it('overrides a model-stated total that disagrees with its own cards', async () => {
    const modelOutput = JSON.stringify({
      cards: [
        { rank: 'K', suit: 'spades', value: 10 },
        { rank: 'A', suit: 'hearts', value: 15 },
      ],
      total: 999, // a wrong model total, which must not survive
    })
    const deps = createDeps({
      geminiClient: { extractCards: vi.fn().mockResolvedValue(modelOutput) },
    })

    const result = await handleCountRequest(validRequest(), deps)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      cards: [
        { rank: 'K', suit: 'spades', value: 10 },
        { rank: 'A', suit: 'hearts', value: 15 },
      ],
      total: 25,
    })
  })
})
