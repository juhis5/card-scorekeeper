// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { base64ByteLength, exceedsSizeCap, MAX_IMAGE_BYTES } from './image'

describe('base64ByteLength', () => {
  it('matches the actual decoded byte length for unpadded base64', () => {
    const base64 = Buffer.from('hello').toString('base64') // 5 bytes, no padding
    expect(base64ByteLength(base64)).toBe(5)
  })

  it('matches the actual decoded byte length for singly-padded base64', () => {
    const base64 = Buffer.from('hello!').toString('base64') // 6 bytes → one '=' pad
    expect(base64ByteLength(base64)).toBe(6)
  })

  it('matches the actual decoded byte length for doubly-padded base64', () => {
    const base64 = Buffer.from('hi').toString('base64') // 2 bytes → two '=' pad
    expect(base64ByteLength(base64)).toBe(2)
  })

  it('matches a larger, realistic payload size', () => {
    const bytes = Buffer.alloc(2_000_000, 1)
    const base64 = bytes.toString('base64')
    expect(base64ByteLength(base64)).toBe(2_000_000)
  })
})

describe('exceedsSizeCap', () => {
  it('allows an image at exactly the cap', () => {
    const base64 = Buffer.alloc(MAX_IMAGE_BYTES, 1).toString('base64')
    expect(exceedsSizeCap(base64)).toBe(false)
  })

  it('rejects an image one byte over the cap', () => {
    const base64 = Buffer.alloc(MAX_IMAGE_BYTES + 1, 1).toString('base64')
    expect(exceedsSizeCap(base64)).toBe(true)
  })

  it('honors an injected cap override', () => {
    const base64 = Buffer.from('hello').toString('base64') // 5 bytes
    expect(exceedsSizeCap(base64, 4)).toBe(true)
    expect(exceedsSizeCap(base64, 5)).toBe(false)
  })
})
