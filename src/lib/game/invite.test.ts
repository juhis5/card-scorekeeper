import { describe, expect, it } from 'vitest'
import { joinUrl, qrPath } from './invite'

describe('joinUrl', () => {
  it('points at the join page for the room, on the address the app runs on', () => {
    expect(joinUrl('https://rommi.vercel.app', '7K4RQ')).toBe('https://rommi.vercel.app/join/7K4RQ')
  })
})

describe('qrPath', () => {
  it('draws one unit square per dark module, at its column and row', () => {
    const modules = [
      [true, false],
      [false, true],
    ]

    expect(qrPath(modules)).toBe('M0 0h1v1h-1zM1 1h1v1h-1z')
  })

  it('draws nothing for an all-light grid', () => {
    expect(qrPath([[false]])).toBe('')
  })
})
