import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useKeepInView } from './useKeepInView'

function elementAt(top: number, bottom: number): HTMLElement {
  const element = document.createElement('div')
  element.getBoundingClientRect = () => ({ top, bottom }) as DOMRect
  return element
}

function pointerIs(kind: 'coarse' | 'fine') {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === `(pointer: ${kind})` }))
}

/** The part of the page on screen: the visual viewport, which a phone keyboard shrinks. */
function visibleFrom(offsetTop: number, height: number) {
  vi.stubGlobal('visualViewport', { offsetTop, height })
}

/** A sticky header or bottom bar, marked the way the app shell marks them. */
function addShellElement(
  attribute: 'data-app-header' | 'data-bottom-bar',
  top: number,
  bottom: number,
) {
  const element = elementAt(top, bottom)
  element.setAttribute(attribute, '')
  document.body.append(element)
}

function spyOnScroll() {
  return vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('useKeepInView', () => {
  it('on a touch screen brings an opening card up under the top of the screen', () => {
    pointerIs('coarse')
    const scrollBy = spyOnScroll()

    useKeepInView(ref(elementAt(600, 730))).reveal()

    expect(scrollBy).toHaveBeenCalledWith({ top: 592 })
  })

  it('with a mouse leaves a card that already shows where it is', () => {
    pointerIs('fine')
    const scrollBy = spyOnScroll()

    useKeepInView(ref(elementAt(300, 430))).reveal()

    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('does nothing before the card is in the page', () => {
    pointerIs('coarse')
    const scrollBy = spyOnScroll()

    useKeepInView(ref(null)).reveal()

    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('treats a browser without matchMedia as one with a mouse', () => {
    vi.stubGlobal('matchMedia', undefined)
    const scrollBy = spyOnScroll()

    useKeepInView(ref(elementAt(300, 430))).reveal()

    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('on a touch screen measures from the top of the visual viewport, not of the page', () => {
    pointerIs('coarse')
    visibleFrom(100, 400)
    const scrollBy = spyOnScroll()

    useKeepInView(ref(elementAt(600, 730))).reveal()

    expect(scrollBy).toHaveBeenCalledWith({ top: 492 })
  })

  it('on a touch screen brings the card up just under the sticky header', () => {
    pointerIs('coarse')
    visibleFrom(0, 768)
    addShellElement('data-app-header', 0, 56)
    const scrollBy = spyOnScroll()

    useKeepInView(ref(elementAt(600, 730))).reveal()

    expect(scrollBy).toHaveBeenCalledWith({ top: 536 })
  })

  it('with a mouse scrolls a card out from behind the bottom bar', () => {
    pointerIs('fine')
    visibleFrom(0, 768)
    addShellElement('data-bottom-bar', 700, 768)
    const scrollBy = spyOnScroll()

    useKeepInView(ref(elementAt(650, 730))).reveal()

    expect(scrollBy).toHaveBeenCalledWith({ top: 30 })
  })

  it('with a mouse ignores a bottom bar that sits below the visible area', () => {
    pointerIs('fine')
    visibleFrom(0, 768)
    addShellElement('data-bottom-bar', 800, 868)
    const scrollBy = spyOnScroll()

    useKeepInView(ref(elementAt(650, 730))).reveal()

    expect(scrollBy).not.toHaveBeenCalled()
  })
})
