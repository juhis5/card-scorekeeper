import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const authStateReady = vi.fn()
const getFirebaseAuth = vi.fn()
const currentGoogleAccount = vi.fn()
const signInWithGoogle = vi.fn()
const signOutOfGoogle = vi.fn()
const signInFailure = vi.fn()
const reportHandledError = vi.fn()
const readOwnClaim = vi.fn()
const claimName = vi.fn()
const auth: { authStateReady: () => unknown; currentUser: { uid: string } | null } = {
  authStateReady: () => authStateReady(),
  currentUser: { uid: 'uid-me' },
}

vi.mock('@/lib/data/firebase', () => ({
  getFirebaseAuth: () => getFirebaseAuth(),
  getDb: () => 'db',
}))
vi.mock('@/lib/data/name-claims', () => ({
  readOwnClaim: (...args: unknown[]) => readOwnClaim(...args),
  claimName: (...args: unknown[]) => claimName(...args),
}))
vi.mock('@/lib/data/google-account', () => ({
  currentGoogleAccount: (...args: unknown[]) => currentGoogleAccount(...args),
  signInWithGoogle: (...args: unknown[]) => signInWithGoogle(...args),
  signOutOfGoogle: (...args: unknown[]) => signOutOfGoogle(...args),
  signInFailure: (error: unknown) => signInFailure(error),
}))
vi.mock('@/lib/platform/error-reporting', () => ({
  reportHandledError: (...args: unknown[]) => reportHandledError(...args),
}))

const { useAccountStore } = await import('./account')

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  getFirebaseAuth.mockReturnValue(auth)
  authStateReady.mockResolvedValue(undefined)
  currentGoogleAccount.mockReturnValue(null)
  readOwnClaim.mockResolvedValue(null)
  auth.currentUser = { uid: 'uid-me' }
})

async function loaded() {
  const account = useAccountStore()
  await account.load()
  return account
}

describe('useAccountStore', () => {
  it('starts loading, then shows the restored session', async () => {
    const account = useAccountStore()
    expect(account.status).toBe('loading')

    currentGoogleAccount.mockReturnValue({ email: 'juho@example.com' })
    await account.load()

    expect(currentGoogleAccount).toHaveBeenCalledWith(auth)
    expect(account.status).toBe('signedIn')
    expect(account.email).toBe('juho@example.com')
  })

  it('is signed out for an anonymous session', async () => {
    const account = await loaded()

    expect(account.status).toBe('signedOut')
    expect(account.email).toBeNull()
  })

  it('reports Firebase failing to load, and offers no sign-in', async () => {
    getFirebaseAuth.mockImplementation(() => {
      throw new Error('blank config')
    })
    const account = await loaded()

    expect(account.status).toBe('unavailable')
    expect(reportHandledError).toHaveBeenCalledWith(expect.any(Error), 'load-account')
  })

  it('does nothing before the session has loaded', async () => {
    const account = useAccountStore()

    await account.signIn()
    await account.signOut()

    expect(signInWithGoogle).not.toHaveBeenCalled()
    expect(signOutOfGoogle).not.toHaveBeenCalled()
  })

  it('signs in with Google, busy until it settles', async () => {
    const account = await loaded()
    let finish: (value: unknown) => void = () => {}
    signInWithGoogle.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    const signingIn = account.signIn()
    expect(account.isBusy).toBe(true)
    await account.signIn()
    expect(signInWithGoogle).toHaveBeenCalledTimes(1)

    finish({ account: { email: 'juho@example.com' }, switchedUser: false })
    await signingIn

    expect(signInWithGoogle).toHaveBeenCalledWith(auth)
    expect(account.isBusy).toBe(false)
    expect(account.status).toBe('signedIn')
    expect(account.email).toBe('juho@example.com')
    expect(account.notice).toBeNull()
  })

  it("says so when the device switched to the account's own uid", async () => {
    const account = await loaded()
    signInWithGoogle.mockResolvedValue({ account: { email: 'a@b.c' }, switchedUser: true })

    await account.signIn()

    expect(account.notice).toBe('switched')
  })

  it('stays quiet when the player closes the popup', async () => {
    const account = await loaded()
    signInWithGoogle.mockRejectedValue(new Error('closed'))
    signInFailure.mockReturnValue('cancelled')

    await account.signIn()

    expect(account.status).toBe('signedOut')
    expect(account.notice).toBeNull()
    expect(reportHandledError).not.toHaveBeenCalled()
  })

  it('tells a blocked popup or no connection, without reporting either', async () => {
    const account = await loaded()
    signInWithGoogle.mockRejectedValue(new Error('blocked'))
    signInFailure.mockReturnValue('blocked')
    await account.signIn()
    expect(account.notice).toBe('blocked')

    signInFailure.mockReturnValue('offline')
    await account.signIn()
    expect(account.notice).toBe('offline')
    expect(reportHandledError).not.toHaveBeenCalled()
  })

  it('reports an unexpected failure', async () => {
    const account = await loaded()
    const error = new Error('internal')
    signInWithGoogle.mockRejectedValue(error)
    signInFailure.mockReturnValue('failed')

    await account.signIn()

    expect(account.notice).toBe('failed')
    expect(account.isBusy).toBe(false)
    expect(reportHandledError).toHaveBeenCalledWith(error, 'google-sign-in')
  })

  it('signs out, clearing the notice first', async () => {
    currentGoogleAccount.mockReturnValue({ email: 'juho@example.com' })
    const account = await loaded()
    account.notice = 'switched'
    signOutOfGoogle.mockResolvedValue(undefined)

    await account.signOut()

    expect(signOutOfGoogle).toHaveBeenCalledWith(auth)
    expect(account.status).toBe('signedOut')
    expect(account.email).toBeNull()
    expect(account.notice).toBeNull()
  })

  it('stays signed in when signing out fails', async () => {
    currentGoogleAccount.mockReturnValue({ email: 'juho@example.com' })
    const account = await loaded()
    signOutOfGoogle.mockRejectedValue(new Error('offline'))
    signInFailure.mockReturnValue('offline')

    await account.signOut()
    await account.signOut()

    expect(account.status).toBe('signedIn')
    expect(account.notice).toBe('offline')
    expect(account.isBusy).toBe(false)
  })

  it('ignores sign-out while a sign-in is running', async () => {
    const account = await loaded()
    signInWithGoogle.mockReturnValue(new Promise(() => {}))

    void account.signIn()
    await account.signOut()

    expect(signOutOfGoogle).not.toHaveBeenCalled()
  })

  describe('claimed name', () => {
    const offline = Object.assign(new Error('offline'), { code: 'unavailable' })

    async function signedIn() {
      currentGoogleAccount.mockReturnValue({ email: 'juho@example.com' })
      const account = await loaded()
      await Promise.resolve()
      return account
    }

    it("reads the account's claim once signed in", async () => {
      readOwnClaim.mockResolvedValue('Juho')
      const account = await signedIn()

      expect(readOwnClaim).toHaveBeenCalledWith('db', 'uid-me')
      expect(account.claimStatus).toBe('claimed')
      expect(account.claimedName).toBe('Juho')
    })

    it('knows an account without a claim, and reads nothing when signed out', async () => {
      expect((await signedIn()).claimStatus).toBe('unclaimed')

      setActivePinia(createPinia())
      readOwnClaim.mockClear()
      currentGoogleAccount.mockReturnValue(null)
      expect((await loaded()).claimStatus).toBe('unknown')
      expect(readOwnClaim).not.toHaveBeenCalled()
    })

    it('leaves the claim unknown offline, reporting only a real failure', async () => {
      readOwnClaim.mockRejectedValue(offline)
      expect((await signedIn()).claimStatus).toBe('unknown')
      expect(reportHandledError).not.toHaveBeenCalled()

      setActivePinia(createPinia())
      const broken = new Error('broken')
      readOwnClaim.mockRejectedValue(broken)
      expect((await signedIn()).claimStatus).toBe('unknown')
      expect(reportHandledError).toHaveBeenCalledWith(broken, 'load-name-claim')
    })

    it('reads no claim without a user', async () => {
      auth.currentUser = null
      await signedIn()

      expect(readOwnClaim).not.toHaveBeenCalled()
    })

    it('drops a claim read that lands after signing out', async () => {
      let finish: (name: string) => void = () => {}
      readOwnClaim.mockReturnValue(new Promise((resolve) => (finish = resolve)))
      const account = await signedIn()
      signOutOfGoogle.mockResolvedValue(undefined)
      await account.signOut()

      finish('Juho')
      await Promise.resolve()

      expect(account.claimStatus).toBe('unknown')
      expect(account.claimedName).toBeNull()
    })

    it('claims the clean name for this account and says so', async () => {
      const account = await signedIn()
      claimName.mockResolvedValue('claimed')

      await account.claim('  Juho ')

      expect(claimName).toHaveBeenCalledWith('db', 'uid-me', '  Juho ')
      expect(account.claimStatus).toBe('claimed')
      expect(account.claimedName).toBe('Juho')
      expect(account.notice).toBe('claimed')
    })

    it("says so when the name is someone else's", async () => {
      const account = await signedIn()
      claimName.mockResolvedValue('taken')

      await account.claim('Juho')

      expect(account.claimStatus).toBe('unclaimed')
      expect(account.notice).toBe('taken')
    })

    it('claims nothing while signed out or without a user', async () => {
      const account = await loaded()
      await account.claim('Juho')

      currentGoogleAccount.mockReturnValue({ email: 'juho@example.com' })
      await account.load()
      auth.currentUser = null
      await account.claim('Juho')

      expect(claimName).not.toHaveBeenCalled()
    })

    it('says offline when the claim cannot reach the server, and reports anything else', async () => {
      const account = await signedIn()
      claimName.mockRejectedValue(offline)
      await account.claim('Juho')
      expect(account.notice).toBe('offline')
      expect(reportHandledError).not.toHaveBeenCalled()

      const broken = new Error('broken')
      claimName.mockRejectedValue(broken)
      await account.claim('Juho')
      expect(account.notice).toBe('failed')
      expect(account.isBusy).toBe(false)
      expect(reportHandledError).toHaveBeenCalledWith(broken, 'claim-name')
    })

    it('moves the claim, forgetting the old name, and marks the notice as a claim one', async () => {
      readOwnClaim.mockResolvedValue('Juho')
      const account = await signedIn()
      claimName.mockResolvedValue('claimed')

      await account.claim('Jussi')

      expect(account.claimedName).toBe('Jussi')
      expect(account.lastAction).toBe('claim')
    })
  })
})
