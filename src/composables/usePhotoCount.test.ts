import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePhotoCount } from './usePhotoCount'

const { auth } = vi.hoisted(() => ({
  auth: { currentUser: null as { getIdToken: () => Promise<string> } | null },
}))
const getAppCheckTokenMock = vi.fn()
vi.mock('@/lib/data/firebase', () => ({
  getFirebaseAuth: () => auth,
  getAppCheckToken: () => getAppCheckTokenMock(),
}))

afterEach(() => {
  auth.currentUser = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const DOWNSCALED = { base64: 'ZmFrZQ==', mimeType: 'image/jpeg' }

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

function makeFile(): Blob {
  return new Blob(['fake-bytes'], { type: 'image/jpeg' })
}

describe('usePhotoCount().countCards, the happy path', () => {
  it('sends the Bearer token, room code, and downscaled image to /api/count', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { cards: [], total: 0 }))
    const { countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: async () => DOWNSCALED,
      fetchImpl,
    })

    await countCards('ABCDE', makeFile())

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/count',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer id-token-abc' }),
      }),
    )
    const [, options] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(options.body as string)).toEqual({
      roomCode: 'ABCDE',
      image: DOWNSCALED.base64,
      mimeType: DOWNSCALED.mimeType,
    })
  })

  it("sends App Check's token when App Check is on, and none when it's off or fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { cards: [], total: 0 }))
    const headersSent = () =>
      (fetchImpl.mock.calls.at(-1) as [string, RequestInit])[1].headers as Record<string, string>
    const count = () =>
      usePhotoCount({
        getIdToken: async () => 'id-token-abc',
        downscale: async () => DOWNSCALED,
        fetchImpl,
      }).countCards('ABCDE', makeFile())

    getAppCheckTokenMock.mockResolvedValueOnce('app-check-token')
    await count()
    expect(headersSent()['X-Firebase-AppCheck']).toBe('app-check-token')

    getAppCheckTokenMock.mockResolvedValueOnce(null)
    await count()
    expect(headersSent()).not.toHaveProperty('X-Firebase-AppCheck')

    getAppCheckTokenMock.mockRejectedValueOnce(new Error('recaptcha blocked'))
    await count()
    expect(headersSent()).not.toHaveProperty('X-Firebase-AppCheck')
  })

  it('returns the parsed cards and total', async () => {
    const cards = [
      { rank: '4', suit: 'diamonds', value: 5 },
      { rank: 'Joker', suit: null, value: 25 },
    ]
    const { countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: async () => DOWNSCALED,
      fetchImpl: async () => jsonResponse(200, { cards, total: 30 }),
    })

    const result = await countCards('ABCDE', makeFile())

    expect(result).toEqual({ ok: true, cards, total: 30 })
  })

  it('tracks isPending across the call', async () => {
    let resolveFetch!: (value: Response) => void
    const fetchImpl = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )
    const { isPending, countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: async () => DOWNSCALED,
      fetchImpl,
    })

    const pending = countCards('ABCDE', makeFile())
    await Promise.resolve() // let the async fn run up to the in-flight fetch
    expect(isPending.value).toBe(true)

    resolveFetch(jsonResponse(200, { cards: [], total: 0 }))
    await pending

    expect(isPending.value).toBe(false)
  })
})

describe('usePhotoCount().countCards, authentication', () => {
  it('returns unauthenticated without calling fetch when no ID token is available', async () => {
    const fetchImpl = vi.fn()
    const { countCards } = usePhotoCount({
      getIdToken: async () => null,
      downscale: async () => DOWNSCALED,
      fetchImpl,
    })

    const result = await countCards('ABCDE', makeFile())

    expect(result).toEqual({ ok: false, reason: 'unauthenticated' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns unauthenticated when getting the ID token itself rejects', async () => {
    const { countCards } = usePhotoCount({
      getIdToken: () => Promise.reject(new Error('token refresh failed')),
      downscale: async () => DOWNSCALED,
      fetchImpl: vi.fn(),
    })

    const result = await countCards('ABCDE', makeFile())

    expect(result).toEqual({ ok: false, reason: 'unauthenticated' })
  })
})

describe('usePhotoCount().countCards, the signed-in Firebase user by default', () => {
  it("sends the signed-in user's ID token as the Bearer token", async () => {
    auth.currentUser = { getIdToken: async () => 'firebase-id-token' }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { cards: [], total: 0 }))
    const { countCards } = usePhotoCount({ downscale: async () => DOWNSCALED, fetchImpl })

    await countCards('ABCDE', makeFile())

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/count',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer firebase-id-token' }),
      }),
    )
  })

  it('returns unauthenticated without calling fetch when nobody is signed in', async () => {
    const fetchImpl = vi.fn()
    const { countCards } = usePhotoCount({ downscale: async () => DOWNSCALED, fetchImpl })

    const result = await countCards('ABCDE', makeFile())

    expect(result).toEqual({ ok: false, reason: 'unauthenticated' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('usePhotoCount().countCards, image downscaling', () => {
  it('downscales the photo itself by default, reporting image-processing when it cannot decode it', async () => {
    const createImageBitmap = vi.fn().mockRejectedValue(new Error('undecodable image'))
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    const file = makeFile()
    const fetchImpl = vi.fn()
    const { countCards } = usePhotoCount({ getIdToken: async () => 'id-token-abc', fetchImpl })

    const result = await countCards('ABCDE', file)

    expect(createImageBitmap).toHaveBeenCalledWith(file, expect.anything())
    expect(result).toEqual({ ok: false, reason: 'image-processing' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns an image-processing failure when downscaling rejects', async () => {
    const fetchImpl = vi.fn()
    const { countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: () => Promise.reject(new Error('canvas encoding failed')),
      fetchImpl,
    })

    const result = await countCards('ABCDE', makeFile())

    expect(result).toEqual({ ok: false, reason: 'image-processing' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('usePhotoCount().countCards, HTTP failure statuses', () => {
  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [429, 'rate-limited'],
    [413, 'image-processing'],
    [422, 'invalid-response'],
    [502, 'server-error'],
    [503, 'unavailable'],
    [504, 'timeout'],
    [500, 'server-error'],
  ] as const)('maps HTTP %d to reason %s', async (status, reason) => {
    const { countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: async () => DOWNSCALED,
      fetchImpl: async () => jsonResponse(status, { error: 'nope' }),
    })

    const result = await countCards('ABCDE', makeFile())

    expect(result).toEqual({ ok: false, reason })
  })

  it('returns invalid-response when the success body does not match the expected shape', async () => {
    const { countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: async () => DOWNSCALED,
      fetchImpl: async () => jsonResponse(200, { unexpected: true }),
    })

    const result = await countCards('ABCDE', makeFile())

    expect(result).toEqual({ ok: false, reason: 'invalid-response' })
  })

  it('returns invalid-response when the success body is JSON null', async () => {
    const { countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: async () => DOWNSCALED,
      fetchImpl: async () => jsonResponse(200, null),
    })

    const result = await countCards('ABCDE', makeFile())

    expect(result).toEqual({ ok: false, reason: 'invalid-response' })
  })

  it('returns invalid-response when a listed card is not an object', async () => {
    const { countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: async () => DOWNSCALED,
      fetchImpl: async () => jsonResponse(200, { cards: [null], total: 0 }),
    })

    const result = await countCards('ABCDE', makeFile())

    expect(result).toEqual({ ok: false, reason: 'invalid-response' })
  })

  it('returns invalid-response when the success body is not valid JSON', async () => {
    const { countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: async () => DOWNSCALED,
      fetchImpl: async () =>
        ({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) }) as Response,
    })

    const result = await countCards('ABCDE', makeFile())

    expect(result).toEqual({ ok: false, reason: 'invalid-response' })
  })
})

describe('usePhotoCount().countCards, network failures', () => {
  it('posts with the browser fetch by default', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { cards: [], total: 0 }))
    vi.stubGlobal('fetch', fetchImpl)
    const { countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: async () => DOWNSCALED,
    })

    const result = await countCards('ABCDE', makeFile())

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/count',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toEqual({ ok: true, cards: [], total: 0 })
  })

  it('aborts a request still unanswered after 20 seconds, not before, and reports a timeout', async () => {
    vi.useFakeTimers()
    const abortError = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    })
    let signal: AbortSignal | undefined
    const fetchImpl = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        signal = init?.signal ?? undefined
        signal?.addEventListener('abort', () => reject(abortError))
      })
    const { countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: async () => DOWNSCALED,
      fetchImpl,
    })

    const outcome = countCards('ABCDE', makeFile())
    await vi.advanceTimersByTimeAsync(19_999)
    expect(signal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toEqual({ ok: false, reason: 'timeout' })
  })

  it('maps an aborted request to a timeout failure', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    })
    const { countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: async () => DOWNSCALED,
      fetchImpl: () => Promise.reject(abortError),
    })

    const result = await countCards('ABCDE', makeFile())

    expect(result).toEqual({ ok: false, reason: 'timeout' })
  })

  it('maps a plain fetch rejection (offline) to a network failure', async () => {
    const { countCards } = usePhotoCount({
      getIdToken: async () => 'id-token-abc',
      downscale: async () => DOWNSCALED,
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    })

    const result = await countCards('ABCDE', makeFile())

    expect(result).toEqual({ ok: false, reason: 'network' })
  })
})
