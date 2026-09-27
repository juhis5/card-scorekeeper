// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTVerifyGetKey,
} from 'jose'
import { createIdTokenVerifier } from './id-token'

const PROJECT_ID = 'demo-project'
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`
const KEY_ID = 'test-key'
const NOW = new Date('2026-09-27T12:00:00Z')
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
  subject?: string | null
  audience?: string
  issuer?: string
  issuedAt?: number
  expiresAt?: number
  authTime?: number
  key?: CryptoKey
}

/** A token shaped like a real Firebase ID token, valid at NOW unless overridden. */
function signToken(overrides: TokenOverrides = {}): Promise<string> {
  const jwt = new SignJWT({ auth_time: overrides.authTime ?? NOW_SECONDS - 60 })
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? PROJECT_ID)
    .setIssuedAt(overrides.issuedAt ?? NOW_SECONDS - 60)
    .setExpirationTime(overrides.expiresAt ?? NOW_SECONDS + 3600)
  const subject = overrides.subject === undefined ? 'player-1' : overrides.subject
  if (subject !== null) jwt.setSubject(subject)
  return jwt.sign(overrides.key ?? signingKey)
}

function verifier() {
  return createIdTokenVerifier({ projectId: PROJECT_ID, keys, now: () => NOW })
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  )
}

describe('createIdTokenVerifier', () => {
  it("returns the token's user id for a valid Firebase ID token", async () => {
    const verify = verifier()
    expect(await verify(await signToken())).toEqual({ uid: 'player-1' })
  })

  it('rejects an expired token as auth/id-token-expired', async () => {
    const token = await signToken({ issuedAt: NOW_SECONDS - 7200, expiresAt: NOW_SECONDS - 3600 })
    expect(await rejection(verifier()(token))).toMatchObject({ code: 'auth/id-token-expired' })
  })

  it.each([
    ['another project as audience', { audience: 'someone-elses-project' }],
    ['another issuer', { issuer: 'https://securetoken.google.com/someone-elses-project' }],
    ['a key that is not one of the published keys', {}],
    ['no subject', { subject: null }],
    ['an empty subject', { subject: '' }],
    ['a sign-in time in the future', { authTime: NOW_SECONDS + 600 }],
  ] as const)('rejects a token with %s as auth/invalid-id-token', async (label, overrides) => {
    const key = label.startsWith('a key') ? otherSigningKey : undefined
    const token = await signToken({ ...overrides, key })
    expect(await rejection(verifier()(token))).toMatchObject({ code: 'auth/invalid-id-token' })
  })

  it('rejects a string that is not a JWT as auth/invalid-id-token', async () => {
    expect(await rejection(verifier()('not-a-jwt'))).toMatchObject({
      code: 'auth/invalid-id-token',
    })
  })

  it('rejects a token signed with a shared secret instead of RS256', async () => {
    const secret = new TextEncoder().encode('a-shared-secret-at-least-32-bytes-long')
    const token = await new SignJWT({ auth_time: NOW_SECONDS - 60 })
      .setProtectedHeader({ alg: 'HS256', kid: KEY_ID })
      .setIssuer(ISSUER)
      .setAudience(PROJECT_ID)
      .setSubject('player-1')
      .setIssuedAt(NOW_SECONDS - 60)
      .setExpirationTime(NOW_SECONDS + 3600)
      .sign(secret)
    expect(await rejection(verifier()(token))).toMatchObject({ code: 'auth/invalid-id-token' })
  })

  it('rethrows a failure to fetch the public keys, so it surfaces as a server error', async () => {
    const unreachableKeys: JWTVerifyGetKey = () => Promise.reject(new Error('network down'))
    const verify = createIdTokenVerifier({
      projectId: PROJECT_ID,
      keys: unreachableKeys,
      now: () => NOW,
    })
    const error = await rejection(verify(await signToken()))
    expect(error).toMatchObject({ message: 'network down' })
    expect((error as { code?: unknown }).code).toBeUndefined()
  })
})
