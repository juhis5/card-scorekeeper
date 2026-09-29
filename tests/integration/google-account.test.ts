/**
 * Google sign-in against the Auth emulator, no mocks. The emulator takes an unsigned JSON id token
 * as a Google credential, which stands in for the popup here. Switching a second device onto an
 * account is unit-tested only: the emulator's "already linked" error leaves out the credential
 * that Google's real one carries.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  linkWithCredential,
  signInAnonymously,
  signInWithCredential,
  type Auth,
} from 'firebase/auth'
import {
  currentGoogleAccount,
  signInWithGoogle,
  signOutOfGoogle,
  type GoogleSignInMethods,
} from '@/lib/data/google-account'

const AUTH_EMULATOR_PORT = 9299

let deviceCount = 0
const apps: FirebaseApp[] = []

function makeDevice(): Auth {
  deviceCount += 1
  const app = initializeApp(
    { projectId: 'demo-card-scorekeeper', apiKey: 'fake-api-key' },
    `google-device-${deviceCount}`,
  )
  apps.push(app)
  const auth = getAuth(app)
  connectAuthEmulator(auth, `http://localhost:${AUTH_EMULATOR_PORT}`, { disableWarnings: true })
  return auth
}

/** A fresh Google account per test, so reruns against the same emulator never collide. */
function googleAccount(): GoogleSignInMethods & { email: string } {
  const sub = `google-${crypto.randomUUID()}`
  const email = `${sub}@example.com`
  const credential = () =>
    GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true }))
  return {
    email,
    link: (user) => linkWithCredential(user, credential()),
    signIn: (auth) => signInWithCredential(auth, credential()),
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => deleteApp(app)))
})

describe('Google sign-in, end-to-end against the Auth emulator', () => {
  it('links Google to the anonymous player, keeping their uid', async () => {
    const auth = makeDevice()
    const { user: anonymous } = await signInAnonymously(auth)
    const google = googleAccount()

    const result = await signInWithGoogle(auth, google)

    expect(result).toEqual({ account: { email: google.email }, switchedUser: false })
    expect(auth.currentUser?.uid).toBe(anonymous.uid)
    expect(currentGoogleAccount(auth)).toEqual({ email: google.email })
  })

  it('signs out to no session; the next sign-in starts a fresh anonymous uid', async () => {
    const auth = makeDevice()
    const { user: anonymous } = await signInAnonymously(auth)
    await signInWithGoogle(auth, googleAccount())

    await signOutOfGoogle(auth)
    expect(auth.currentUser).toBeNull()
    const { user: fresh } = await signInAnonymously(auth)

    expect(fresh.uid).not.toBe(anonymous.uid)
  })
})
