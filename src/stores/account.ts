/**
 * The Google account on this device, for the menu. Firebase loads when the menu opens, so the tap
 * on "Sign in" reaches the popup with nothing left to load: phones only open one soon after a tap.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Auth } from 'firebase/auth'
import type { GoogleAccount, SignInFailure } from '@/lib/data/google-account'
import { reportHandledError } from '@/lib/platform/error-reporting'

/** `unavailable`: Firebase didn't load (a broken config or a missing chunk), so no sign-in here. */
export type AccountStatus = 'loading' | 'unavailable' | 'signedOut' | 'signedIn'

/** What the menu says after a sign-in or sign-out attempt. */
export type AccountNotice = Exclude<SignInFailure, 'cancelled'> | 'switched'

interface Session {
  auth: Auth
  google: typeof import('@/lib/data/google-account')
}

export const useAccountStore = defineStore('account', () => {
  const status = ref<AccountStatus>('loading')
  const email = ref<string | null>(null)
  const isBusy = ref(false)
  const notice = ref<AccountNotice | null>(null)
  let session: Session | null = null

  function show(account: GoogleAccount | null): void {
    email.value = account?.email ?? null
    status.value = account ? 'signedIn' : 'signedOut'
  }

  /** Never throws. Works offline: the session restores from this device's storage. */
  async function load(): Promise<void> {
    try {
      const [{ getFirebaseAuth }, google] = await Promise.all([
        import('@/lib/data/firebase'),
        import('@/lib/data/google-account'),
      ])
      const auth = getFirebaseAuth()
      await auth.authStateReady()
      session = { auth, google }
      show(google.currentGoogleAccount(auth))
    } catch (error) {
      reportHandledError(error, 'load-account')
      status.value = 'unavailable'
    }
  }

  function fail(google: Session['google'], error: unknown): void {
    const failure = google.signInFailure(error)
    if (failure === 'failed') reportHandledError(error, 'google-sign-in')
    notice.value = failure === 'cancelled' ? null : failure
  }

  async function signIn(): Promise<void> {
    if (!session || isBusy.value) return
    const { auth, google } = session
    isBusy.value = true
    notice.value = null
    try {
      const { account, switchedUser } = await google.signInWithGoogle(auth)
      show(account)
      if (switchedUser) notice.value = 'switched'
    } catch (error) {
      fail(google, error)
    } finally {
      isBusy.value = false
    }
  }

  async function signOut(): Promise<void> {
    if (!session || isBusy.value) return
    const { auth, google } = session
    isBusy.value = true
    notice.value = null
    try {
      await google.signOutOfGoogle(auth)
      show(null)
    } catch (error) {
      fail(google, error)
    } finally {
      isBusy.value = false
    }
  }

  return { status, email, isBusy, notice, load, signIn, signOut }
})
