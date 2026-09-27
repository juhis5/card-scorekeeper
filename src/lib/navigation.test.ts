import { describe, expect, it } from 'vitest'
import { hasInAppBack } from './navigation'

describe('hasInAppBack', () => {
  it('is true when the router recorded a previous page in this tab', () => {
    expect(hasInAppBack({ back: '/' })).toBe(true)
  })

  it('is false when the page was opened directly, such as from a room link', () => {
    expect(hasInAppBack({ back: null })).toBe(false)
  })

  it('is false without router history state', () => {
    expect(hasInAppBack(null)).toBe(false)
    expect(hasInAppBack({})).toBe(false)
    expect(hasInAppBack('/')).toBe(false)
  })
})
