/**
 * Google sign-in on top of the anonymous session. Linking keeps the anonymous uid, so what this
 * device already played stays with the player. A Google account can belong to only one uid: when
 * it's already in use (signed in on another device), this device switches to that uid and its
 * anonymous history stays behind under the old one.
 */
import { FirebaseError } from 'firebase/app'
import {
  GoogleAuthProvider,
  linkWithPopup,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
  type UserCredential,
} from 'firebase/auth'

export interface GoogleAccount {
  email: string | null
}

export interface GoogleSignIn {
  account: GoogleAccount
  /** The account belonged to another uid, which this device now uses instead of its own. */
  switchedUser: boolean
}

/** Why a sign-in didn't happen, as the menu tells it. `cancelled` is the player's own choice. */
export type SignInFailure = 'cancelled' | 'blocked' | 'offline' | 'failed'

/** The two ways into Google: popups in the app, credentials in the emulator tests. */
export interface GoogleSignInMethods {
  link: (user: User) => Promise<UserCredential>
  signIn: (auth: Auth) => Promise<UserCredential>
}

const POPUP_METHODS: GoogleSignInMethods = {
  link: (user) => linkWithPopup(user, new GoogleAuthProvider()),
  signIn: (auth) => signInWithPopup(auth, new GoogleAuthProvider()),
}

const FAILURES_BY_CODE: Record<string, SignInFailure> = {
  'auth/popup-closed-by-user': 'cancelled',
  'auth/cancelled-popup-request': 'cancelled',
  'auth/user-cancelled': 'cancelled',
  'auth/popup-blocked': 'blocked',
  'auth/network-request-failed': 'offline',
  'auth/timeout': 'offline',
}

/** A linked user's own email can stay empty; the Google profile always has one. */
function googleEmail(user: User): string | null {
  return (
    user.email ??
    user.providerData.find((profile) => profile.providerId === 'google.com')?.email ??
    null
  )
}

/** The signed-in Google account, or null for an anonymous (or no) session. */
export function currentGoogleAccount(auth: Auth): GoogleAccount | null {
  const user = auth.currentUser
  if (!user || user.isAnonymous) return null
  return { email: googleEmail(user) }
}

export function signInFailure(error: unknown): SignInFailure {
  if (!(error instanceof FirebaseError)) return 'failed'
  return FAILURES_BY_CODE[error.code] ?? 'failed'
}

async function linkOrSwitch(
  auth: Auth,
  user: User,
  methods: GoogleSignInMethods,
): Promise<GoogleSignIn> {
  try {
    const linked = await methods.link(user)
    return { account: { email: googleEmail(linked.user) }, switchedUser: false }
  } catch (error) {
    if (!(error instanceof FirebaseError) || error.code !== 'auth/credential-already-in-use') {
      throw error
    }
    const credential = GoogleAuthProvider.credentialFromError(error)
    if (!credential) throw error
    const existing = await signInWithCredential(auth, credential)
    return { account: { email: googleEmail(existing.user) }, switchedUser: true }
  }
}

/**
 * Call straight from the tap, with nothing awaited first: phones only open a popup soon after it.
 * A device that never went online has no anonymous user to keep, so it signs in directly.
 */
export async function signInWithGoogle(
  auth: Auth,
  methods: GoogleSignInMethods = POPUP_METHODS,
): Promise<GoogleSignIn> {
  const user = auth.currentUser
  if (user) return linkOrSwitch(auth, user, methods)
  const signedIn = await methods.signIn(auth)
  return { account: { email: googleEmail(signedIn.user) }, switchedUser: false }
}

/** The next online action signs this device in anonymously again, with a fresh uid. */
export function signOutOfGoogle(auth: Auth): Promise<void> {
  return signOut(auth)
}
