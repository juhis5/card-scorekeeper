// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTVerifyGetKey,
} from 'jose'
import { createAppCheckVerifier } from './app-check-token'

const PROJECT_NUMBER = '123456789'
const ISSUER = `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`
const KEY_ID = 'app-check-key'
const NOW = new Date('2026-09-29T12:00:00Z')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)

let signingKey: CryptoKey
let otherSigningKey: CryptoKey
let keys: JWTVerifyGetKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  signingKey = pair.privateKey
  otherSigningKey = (await generateKeyPair('RS256')).privateKey
  const publicJwk = await exportJWK(pair.publicKey)
  keys = createLocalJWKSet({ keys: [{ ...publicJwk, kid: KEY_ID, alg: 'RS256' }] })
})

interface TokenOverrides {
  audience?: string[]
  issuer?: string
  expiresAt?: number
  typ?: string
  key?: CryptoKey
}

/** Shaped like a real App Check token: both the project number and id in `aud`. */
function signToken(overrides: TokenOverrides = {}): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID, typ: overrides.typ ?? 'JWT' })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? [`projects/${PROJECT_NUMBER}`, 'projects/demo-project'])
    .setSubject('1:123456789:web:abc')
    .setIssuedAt(NOW_SECONDS - 60)
    .setExpirationTime(overrides.expiresAt ?? NOW_SECONDS + 3600)
    .sign(overrides.key ?? signingKey)
}

function verify(token: string): Promise<void> {
  return createAppCheckVerifier({ projectNumber: PROJECT_NUMBER, keys, now: () => NOW })(token)
}

async function rejectionCode(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => (error as { code?: unknown }).code,
  )
}

describe('createAppCheckVerifier', () => {
  it("accepts a token this project's App Check issued", async () => {
    await expect(verify(await signToken())).resolves.toBeUndefined()
  })

  // Lazy: the other key exists only once beforeAll has run.
  it.each<[string, () => TokenOverrides]>([
    [
      'another project',
      () => ({
        audience: ['projects/999'],
        issuer: 'https://firebaseappcheck.googleapis.com/999',
      }),
    ],
    ['a wrong issuer', () => ({ issuer: 'https://securetoken.google.com/demo-project' })],
    ['an expired token', () => ({ expiresAt: NOW_SECONDS - 1 })],
    ['a header that is not a JWT', () => ({ typ: 'at+jwt' })],
    ['a signature by another key', () => ({ key: otherSigningKey })],
  ])('rejects %s as an invalid token', async (_case, overrides) => {
    const token = await signToken(overrides())

    expect(await rejectionCode(verify(token))).toBe('appCheck/invalid-token')
  })

  it('rejects garbage as an invalid token', async () => {
    expect(await rejectionCode(verify('not-a-token'))).toBe('appCheck/invalid-token')
  })

  it("passes on a failure to fetch the keys: that's the server's problem", async () => {
    const timeout = new errors.JWKSTimeout()
    const failing = createAppCheckVerifier({
      projectNumber: PROJECT_NUMBER,
      keys: () => Promise.reject(timeout),
      now: () => NOW,
    })

    await expect(failing(await signToken())).rejects.toBe(timeout)
  })

  it('checks expiry against the real clock by default', async () => {
    const liveSeconds = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: KEY_ID, typ: 'JWT' })
      .setIssuer(ISSUER)
      .setAudience(`projects/${PROJECT_NUMBER}`)
      .setIssuedAt(liveSeconds - 60)
      .setExpirationTime(liveSeconds + 3600)
      .sign(signingKey)

    await expect(
      createAppCheckVerifier({ projectNumber: PROJECT_NUMBER, keys })(token),
    ).resolves.toBeUndefined()
  })
})
