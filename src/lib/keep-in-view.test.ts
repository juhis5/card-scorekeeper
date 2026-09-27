import { describe, expect, it } from 'vitest'
import { scrollToReveal } from './keep-in-view'

// The visible part of the page: its top and bottom, in the same coordinates as the element.
const visible = { top: 0, bottom: 400 }
const margins = { top: 52, bottom: 80 }

describe('scrollToReveal', () => {
  it('does not scroll when the element already shows between the header and the bottom bar', () => {
    expect(scrollToReveal({ top: 100, bottom: 300 }, visible, margins)).toBe(0)
  })

  it('scrolls down just enough when the keyboard hides the bottom of the element', () => {
    expect(scrollToReveal({ top: 250, bottom: 420 }, visible, margins)).toBe(100)
  })

  it('scrolls up when the element slips under the header', () => {
    expect(scrollToReveal({ top: 20, bottom: 200 }, visible, margins)).toBe(-32)
  })

  it('shows the top when the element is taller than the room left', () => {
    expect(scrollToReveal({ top: 200, bottom: 700 }, visible, margins)).toBe(148)
  })

  it('works with the visible part scrolled away from the page top (iPhone keyboard)', () => {
    expect(scrollToReveal({ top: 500, bottom: 650 }, { top: 300, bottom: 600 }, margins)).toBe(130)
  })
})
