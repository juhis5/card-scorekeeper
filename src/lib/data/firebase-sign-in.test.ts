import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auth, User } from 'firebase/auth'

const signInAnonymously = vi.fn()

vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/auth')>()),
  signInAnonymously: (auth: FakeAuth) => signInAnonymously(auth),
}))

const { ensureSignedIn } = await import('./firebase')

interface FakeAuth {
  currentUser: Pick<User, 'uid'> | null
  authStateReady: () => Promise<void>
}

/** An Auth whose saved user appears only once its state is ready, as on a cold start. */
function coldStartAuth(savedUser: Pick<User, 'uid'> | null): FakeAuth {
  const auth: FakeAuth = {
    currentUser: null,
    authStateReady: () => {
      auth.currentUser = savedUser
      return Promise.resolve()
    },
  }
  return auth
}

function signsInAs(auth: FakeAuth, uid: string): void {
  signInAnonymously.mockImplementation(() => {
    auth.currentUser = { uid }
    return Promise.resolve({ user: { uid } })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ensureSignedIn', () => {
  it('keeps the saved session, a Google one included, instead of signing in anew', async () => {
    const auth = coldStartAuth({ uid: 'google-uid' })

    await expect(ensureSignedIn(auth as unknown as Auth)).resolves.toBe('google-uid')
    expect(signInAnonymously).not.toHaveBeenCalled()
  })

  it('signs in anonymously once for callers that arrive together', async () => {
    const auth = coldStartAuth(null)
    signsInAs(auth, 'anon-uid')

    const uids = await Promise.all([
      ensureSignedIn(auth as unknown as Auth),
      ensureSignedIn(auth as unknown as Auth),
    ])

    expect(uids).toEqual(['anon-uid', 'anon-uid'])
    expect(signInAnonymously).toHaveBeenCalledTimes(1)
  })

  it('signs in afresh after a sign-out, and after a failed attempt', async () => {
    const auth = coldStartAuth(null)
    signsInAs(auth, 'first-uid')
    await ensureSignedIn(auth as unknown as Auth)

    auth.currentUser = null
    signsInAs(auth, 'second-uid')
    await expect(ensureSignedIn(auth as unknown as Auth)).resolves.toBe('second-uid')

    auth.currentUser = null
    signInAnonymously.mockRejectedValueOnce(new Error('offline'))
    await expect(ensureSignedIn(auth as unknown as Auth)).rejects.toThrow('offline')
    signsInAs(auth, 'third-uid')
    await expect(ensureSignedIn(auth as unknown as Auth)).resolves.toBe('third-uid')
  })
})
