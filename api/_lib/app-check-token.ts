/**
 * Verifies a Firebase App Check token with `jose`, following Firebase's steps for third-party JWT
 * libraries: RS256, a JWT header, the App Check issuer and audience for this project's number, not
 * expired. Same reason as `id-token.ts` for not using `firebase-admin/app-check`.
 */
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose'

/** App Check's public keys, as a JWK set. */
export const APP_CHECK_KEYS_URL = 'https://firebaseappcheck.googleapis.com/v1/jwks'

export interface AppCheckVerifierOptions {
  /** The Firebase project's number: the web config's messaging sender id. */
  projectNumber: string
  /** `createRemoteJWKSet(new URL(APP_CHECK_KEYS_URL))` in production. */
  keys: JWTVerifyGetKey
  now?: () => Date
}

/** Resolves for a valid token; a bad one rejects with an `appCheck/...` code, which the handler
 * answers with a 401. Anything else, such as a failed key fetch, is rethrown as is (a logged
 * 500). */
export function createAppCheckVerifier({
  projectNumber,
  keys,
  now = () => new Date(),
}: AppCheckVerifierOptions): (token: string) => Promise<void> {
  return async (token) => {
    try {
      await jwtVerify(token, keys, {
        algorithms: ['RS256'],
        typ: 'JWT',
        issuer: `https://firebaseappcheck.googleapis.com/${projectNumber}`,
        audience: `projects/${projectNumber}`,
        currentDate: now(),
      })
    } catch (error) {
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
        throw Object.assign(new Error(error.code), { code: 'appCheck/invalid-token' })
      }
      throw error
    }
  }
}
