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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useKeepInView', () => {
  it('on a touch screen brings an opening card up under the top of the screen', () => {
    pointerIs('coarse')
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    useKeepInView(ref(elementAt(600, 730))).reveal()

    expect(scrollBy).toHaveBeenCalledWith({ top: 592 })
  })

  it('with a mouse leaves a card that already shows where it is', () => {
    pointerIs('fine')
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    useKeepInView(ref(elementAt(300, 430))).reveal()

    expect(scrollBy).not.toHaveBeenCalled()
  })
})
