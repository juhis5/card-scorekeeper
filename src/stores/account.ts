/**
 * The Google account on this device and the name it claimed, for the Account page. Firebase loads
 * when the page opens, so the tap on "Sign in" reaches the popup with nothing left to load:
 * phones only open one soon after a tap.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { rememberClaim } from '@/composables/useClaimedNames'
import type { GoogleAccount, SignInFailure } from '@/lib/data/google-account'
import { isUnavailable } from '@/lib/data/write-errors'
import { cleanPlayerName } from '@/lib/game/player-names'
import { reportHandledError } from '@/lib/platform/error-reporting'
// Type-only import: makes the `persist` option below typecheck in every tsconfig project.
import type {} from 'pinia-plugin-persistedstate'

/** `unavailable`: Firebase didn't load (a broken config or a missing chunk), so no sign-in here. */
export type AccountStatus = 'loading' | 'unavailable' | 'signedOut' | 'signedIn'

/** `unknown` until the claim is read, and while it can't be (offline). */
export type ClaimStatus = 'unknown' | 'unclaimed' | 'claimed'

/** What the Account page says after an attempt to sign in, sign out or claim a name. */
export type AccountNotice = Exclude<SignInFailure, 'cancelled'> | 'switched' | 'claimed' | 'taken'

/** Which action the notice is about, so it shows by the part of the page that caused it. */
export type AccountAction = 'signIn' | 'signOut' | 'claim'

interface Session {
  auth: Auth
  getDb: () => Firestore
  google: typeof import('@/lib/data/google-account')
  claims: typeof import('@/lib/data/name-claims')
}

export const useAccountStore = defineStore(
  'account',
  () => {
    const status = ref<AccountStatus>('loading')
    const email = ref<string | null>(null)
    const claimStatus = ref<ClaimStatus>('unknown')
    const claimedName = ref<string | null>(null)
    const isBusy = ref(false)
    const notice = ref<AccountNotice | null>(null)
    const lastAction = ref<AccountAction | null>(null)
    let session: Session | null = null

    function showClaim(name: string | null): void {
      claimedName.value = name
      claimStatus.value = name === null ? 'unclaimed' : 'claimed'
    }

    function forgetClaim(): void {
      claimedName.value = null
      claimStatus.value = 'unknown'
    }

    /** Never throws. Offline, the claim stays unknown until the menu opens again. */
    async function loadClaim({ auth, getDb, claims }: Session): Promise<void> {
      const uid = auth.currentUser?.uid
      if (!uid) return
      try {
        const name = await claims.readOwnClaim(getDb(), uid)
        // Signed out or switched meanwhile: that claim is no longer this device's.
        if (auth.currentUser?.uid === uid && status.value === 'signedIn') showClaim(name)
      } catch (error) {
        if (!isUnavailable(error)) reportHandledError(error, 'load-name-claim')
      }
    }

    function show(account: GoogleAccount | null): void {
      email.value = account?.email ?? null
      status.value = account ? 'signedIn' : 'signedOut'
      forgetClaim()
      if (account && session) void loadClaim(session)
    }

    /** Never throws. Works offline: the session restores from this device's storage. */
    async function load(): Promise<void> {
      try {
        const [{ getFirebaseAuth, getDb }, google, claims] = await Promise.all([
          import('@/lib/data/firebase'),
          import('@/lib/data/google-account'),
          import('@/lib/data/name-claims'),
        ])
        const auth = getFirebaseAuth()
        await auth.authStateReady()
        session = { auth, getDb, google, claims }
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

    /** Runs one account action at a time, clearing the last notice first. */
    async function busyWith(
      name: AccountAction,
      action: (current: Session) => Promise<void>,
    ): Promise<void> {
      if (!session || isBusy.value) return
      isBusy.value = true
      notice.value = null
      lastAction.value = name
      try {
        await action(session)
      } finally {
        isBusy.value = false
      }
    }

    function signIn(): Promise<void> {
      return busyWith('signIn', async ({ auth, google }) => {
        try {
          const { account, switchedUser } = await google.signInWithGoogle(auth)
          show(account)
          if (switchedUser) notice.value = 'switched'
        } catch (error) {
          fail(google, error)
        }
      })
    }

    function signOut(): Promise<void> {
      return busyWith('signOut', async ({ auth, google }) => {
        try {
          await google.signOutOfGoogle(auth)
          show(null)
        } catch (error) {
          fail(google, error)
        }
      })
    }

    /** Claims `name` for this account, or moves its claim there. */
    function claim(name: string): Promise<void> {
      return busyWith('claim', async ({ auth, getDb, claims }) => {
        const uid = auth.currentUser?.uid
        if (status.value !== 'signedIn' || !uid) return
        try {
          const outcome = await claims.claimName(getDb(), uid, name)
          if (outcome === 'claimed') {
            // A move frees the old name.
            if (claimedName.value) rememberClaim(claimedName.value, null)
            showClaim(cleanPlayerName(name))
            rememberClaim(name, uid)
          }
          notice.value = outcome
        } catch (error) {
          if (isUnavailable(error)) {
            notice.value = 'offline'
            return
          }
          reportHandledError(error, 'claim-name')
          notice.value = 'failed'
        }
      })
    }

    return {
      status,
      email,
      claimStatus,
      claimedName,
      isBusy,
      notice,
      lastAction,
      load,
      signIn,
      signOut,
      claim,
    }
  },
  // The email doubles as a hint that this device is signed in, so Home can look for invites
  // without loading Firebase for everyone.
  { persist: { pick: ['email'] } },
)
