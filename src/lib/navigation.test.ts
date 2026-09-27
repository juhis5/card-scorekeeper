import { describe, expect, it } from 'vitest'
import { hasInAppBack, playAgainNamesFrom } from './navigation'

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

describe('playAgainNamesFrom', () => {
  it("reads a finished local game's names, host first", () => {
    expect(playAgainNamesFrom({ playAgainNames: ['Juho', 'Jani', 'Ripa'] })).toEqual([
      'Juho',
      'Jani',
      'Ripa',
    ])
  })

  it('is null when the page was not opened through Play again', () => {
    expect(playAgainNamesFrom(null)).toBeNull()
    expect(playAgainNamesFrom({ back: '/' })).toBeNull()
  })

  it('is null for anything that is not a list of names', () => {
    expect(playAgainNamesFrom({ playAgainNames: [] })).toBeNull()
    expect(playAgainNamesFrom({ playAgainNames: 'Juho' })).toBeNull()
    expect(playAgainNamesFrom({ playAgainNames: ['Juho', 3] })).toBeNull()
  })
})
