// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseBearerToken, parseCountRequestBody } from './request'

describe('parseCountRequestBody', () => {
  it('parses a well-formed body', () => {
    const body = { roomCode: 'ABCD', image: 'aGVsbG8=', mimeType: 'image/jpeg' }
    expect(parseCountRequestBody(body)).toEqual(body)
  })

  it('parses a JSON-string body the same way', () => {
    const body = { roomCode: 'ABCD', image: 'aGVsbG8=', mimeType: 'image/jpeg' }
    expect(parseCountRequestBody(JSON.stringify(body))).toEqual(body)
  })

  it('rejects an unparseable JSON string', () => {
    expect(parseCountRequestBody('not json')).toBeNull()
  })

  it('rejects a missing roomCode', () => {
    expect(parseCountRequestBody({ image: 'aGVsbG8=', mimeType: 'image/jpeg' })).toBeNull()
  })

  it('rejects an empty roomCode', () => {
    expect(
      parseCountRequestBody({ roomCode: '', image: 'aGVsbG8=', mimeType: 'image/jpeg' }),
    ).toBeNull()
  })

  it('rejects a missing image', () => {
    expect(parseCountRequestBody({ roomCode: 'ABCD', mimeType: 'image/jpeg' })).toBeNull()
  })

  it('rejects a mimeType that is not an image type', () => {
    expect(
      parseCountRequestBody({ roomCode: 'ABCD', image: 'aGVsbG8=', mimeType: 'text/plain' }),
    ).toBeNull()
  })

  it('rejects null', () => {
    expect(parseCountRequestBody(null)).toBeNull()
  })

  it('rejects a non-object body', () => {
    expect(parseCountRequestBody(42)).toBeNull()
  })
})

describe('parseBearerToken', () => {
  it('extracts the token from a well-formed Authorization header', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123')
  })

  it('is case-insensitive on the "Bearer" scheme', () => {
    expect(parseBearerToken('bearer abc123')).toBe('abc123')
  })

  it('returns null for a missing header', () => {
    expect(parseBearerToken(undefined)).toBeNull()
  })

  it('returns null for a header without the Bearer scheme', () => {
    expect(parseBearerToken('abc123')).toBeNull()
  })

  it('returns null for an empty Bearer token', () => {
    expect(parseBearerToken('Bearer ')).toBeNull()
  })

  it('takes the first value when the header is repeated', () => {
    expect(parseBearerToken(['Bearer first', 'Bearer second'])).toBe('first')
  })
})
