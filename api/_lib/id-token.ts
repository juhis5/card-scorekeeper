/**
 * Verifies a Firebase ID token with `jose`, following Firebase's documented checks for
 * third-party JWT libraries: RS256 signature against Google's published keys, audience and
 * issuer equal to the project, not expired, a non-empty `sub` (the uid) and a past `auth_time`.
 *
 * Not the Admin SDK's `verifyIdToken`: `firebase-admin/auth` loads `jwks-rsa`, which `require()`s
 * the ESM-only `jose` v6. Node 24 allows that, but Vercel's function loader does not, so the whole
 * function failed to load (see docs/DECISIONS.md, 2026-09-27 deploy fix).
 */
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose'

/** Google's public keys for Firebase ID tokens, as a JWK set. */
export const FIREBASE_ID_TOKEN_KEYS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'

const MAX_UID_LENGTH = 128

/** jose error codes that mean "this token is bad", as opposed to "we couldn't check it". */
const INVALID_TOKEN_CODES: ReadonlySet<string> = new Set([
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_INVALID',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
])

export interface IdTokenVerifierOptions {
  projectId: string
  /** `createRemoteJWKSet(new URL(FIREBASE_ID_TOKEN_KEYS_URL))` in production. */
  keys: JWTVerifyGetKey
  now?: () => Date
}

/** Errors carry Firebase Auth's `auth/...` codes, so `gate.ts` treats them as the caller's fault;
 * anything else (e.g. the key fetch failing) is rethrown untouched and becomes a logged 500. */
export function createIdTokenVerifier({
  projectId,
  keys,
  now = () => new Date(),
}: IdTokenVerifierOptions): (idToken: string) => Promise<{ uid: string }> {
  return async (idToken) => {
    const currentDate = now()
    let payload
    try {
      ;({ payload } = await jwtVerify(idToken, keys, {
        algorithms: ['RS256'],
        audience: projectId,
        issuer: `https://securetoken.google.com/${projectId}`,
        currentDate,
      }))
    } catch (error) {
      throw toAuthError(error)
    }

    const { sub, auth_time: authTime } = payload
    if (typeof sub !== 'string' || sub.length === 0 || sub.length > MAX_UID_LENGTH) {
      throw authError('auth/invalid-id-token', 'ID token has no valid subject')
    }
    if (typeof authTime !== 'number' || authTime * 1000 > currentDate.getTime()) {
      throw authError('auth/invalid-id-token', 'ID token has no valid auth_time')
    }
    return { uid: sub }
  }
}

function toAuthError(error: unknown): unknown {
  if (error instanceof errors.JWTExpired) {
    return authError('auth/id-token-expired', 'ID token has expired')
  }
  if (error instanceof errors.JOSEError && INVALID_TOKEN_CODES.has(error.code)) {
    return authError('auth/invalid-id-token', error.code)
  }
  return error
}

function authError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
