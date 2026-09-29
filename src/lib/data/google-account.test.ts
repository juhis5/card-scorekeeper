import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FirebaseError } from 'firebase/app'
import type { Auth, User, UserCredential } from 'firebase/auth'

const linkWithPopup = vi.fn()
const signInWithPopup = vi.fn()
const signInWithCredential = vi.fn()
const signOut = vi.fn()
const credentialFromError = vi.fn()

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    static credentialFromError = (error: unknown) => credentialFromError(error)
  },
  linkWithPopup: (...args: unknown[]) => linkWithPopup(...args),
  signInWithPopup: (...args: unknown[]) => signInWithPopup(...args),
  signInWithCredential: (...args: unknown[]) => signInWithCredential(...args),
  signOut: (...args: unknown[]) => signOut(...args),
}))

const { currentGoogleAccount, signInFailure, signInWithGoogle, signOutOfGoogle } =
  await import('./google-account')

function fakeUser(overrides: Partial<User> = {}): User {
  return { uid: 'anon-uid', isAnonymous: true, email: null, providerData: [], ...overrides } as User
}

function fakeAuth(currentUser: User | null): Auth {
  return { currentUser } as Auth
}

function credentialFor(user: User): UserCredential {
  return { user } as UserCredential
}

const googleUser = fakeUser({ isAnonymous: false, email: 'juho@example.com' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('currentGoogleAccount', () => {
  it('is null without a session or for an anonymous one', () => {
    expect(currentGoogleAccount(fakeAuth(null))).toBeNull()
    expect(currentGoogleAccount(fakeAuth(fakeUser()))).toBeNull()
  })

  it("names a Google user's email, from the Google profile when the user has none", () => {
    expect(currentGoogleAccount(fakeAuth(googleUser))).toEqual({ email: 'juho@example.com' })

    const linked = fakeUser({
      isAnonymous: false,
      providerData: [
        { providerId: 'password', email: 'other@example.com' },
        { providerId: 'google.com', email: 'juho@example.com' },
      ] as User['providerData'],
    })
    expect(currentGoogleAccount(fakeAuth(linked))).toEqual({ email: 'juho@example.com' })
    expect(currentGoogleAccount(fakeAuth(fakeUser({ isAnonymous: false })))).toEqual({
      email: null,
    })
  })
})

describe('signInWithGoogle', () => {
  it('links Google to the anonymous user, keeping its uid', async () => {
    const anonymous = fakeUser()
    linkWithPopup.mockResolvedValue(credentialFor(googleUser))

    const result = await signInWithGoogle(fakeAuth(anonymous))

    expect(linkWithPopup).toHaveBeenCalledWith(anonymous, expect.anything())
    expect(result).toEqual({ account: { email: 'juho@example.com' }, switchedUser: false })
  })

  it('signs in directly on a device that never signed in', async () => {
    const auth = fakeAuth(null)
    signInWithPopup.mockResolvedValue(credentialFor(googleUser))

    const result = await signInWithGoogle(auth)

    expect(signInWithPopup).toHaveBeenCalledWith(auth, expect.anything())
    expect(result).toEqual({ account: { email: 'juho@example.com' }, switchedUser: false })
  })

  it("switches to the account's own uid when another device already linked it", async () => {
    const auth = fakeAuth(fakeUser())
    const inUse = new FirebaseError('auth/credential-already-in-use', 'in use')
    linkWithPopup.mockRejectedValue(inUse)
    credentialFromError.mockReturnValue('google-credential')
    signInWithCredential.mockResolvedValue(credentialFor(googleUser))

    const result = await signInWithGoogle(auth)

    expect(credentialFromError).toHaveBeenCalledWith(inUse)
    expect(signInWithCredential).toHaveBeenCalledWith(auth, 'google-credential')
    expect(result).toEqual({ account: { email: 'juho@example.com' }, switchedUser: true })
  })

  it('rethrows an in-use error that carries no credential', async () => {
    const inUse = new FirebaseError('auth/credential-already-in-use', 'in use')
    linkWithPopup.mockRejectedValue(inUse)
    credentialFromError.mockReturnValue(null)

    await expect(signInWithGoogle(fakeAuth(fakeUser()))).rejects.toBe(inUse)
    expect(signInWithCredential).not.toHaveBeenCalled()
  })

  it('rethrows any other failure untouched', async () => {
    const closed = new FirebaseError('auth/popup-closed-by-user', 'closed')
    linkWithPopup.mockRejectedValue(closed)
    await expect(signInWithGoogle(fakeAuth(fakeUser()))).rejects.toBe(closed)

    const broken = new Error('broken')
    linkWithPopup.mockRejectedValue(broken)
    await expect(signInWithGoogle(fakeAuth(fakeUser()))).rejects.toBe(broken)
    expect(credentialFromError).not.toHaveBeenCalled()
  })
})

describe('signInFailure', () => {
  it.each([
    ['auth/popup-closed-by-user', 'cancelled'],
    ['auth/cancelled-popup-request', 'cancelled'],
    ['auth/user-cancelled', 'cancelled'],
    ['auth/popup-blocked', 'blocked'],
    ['auth/network-request-failed', 'offline'],
    ['auth/timeout', 'offline'],
    ['auth/internal-error', 'failed'],
  ])('reads %s as %s', (code, failure) => {
    expect(signInFailure(new FirebaseError(code, code))).toBe(failure)
  })

  it('reads anything else as failed', () => {
    expect(signInFailure(new Error('boom'))).toBe('failed')
  })
})

describe('signOutOfGoogle', () => {
  it('signs the device out', async () => {
    const auth = fakeAuth(googleUser)
    signOut.mockResolvedValue(undefined)

    await signOutOfGoogle(auth)

    expect(signOut).toHaveBeenCalledWith(auth)
  })
})
