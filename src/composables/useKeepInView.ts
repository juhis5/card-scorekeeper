/**
 * Places a card as it opens, before its field is focused. On a touch screen it goes up to just
 * under the sticky header (`data-app-header`): a phone doesn't scroll a field it focuses from code
 * out from behind its keyboard (only one the finger tapped), and the keyboard only ever covers the
 * lower part of the screen (third playtest, iPhone: the lowest cards' fields stayed hidden). With a
 * mouse it just moves clear of the header and a room's bottom bar (`data-bottom-bar`).
 *
 * Deliberately not a resize listener. Following window.visualViewport while the keyboard was up
 * fought the player's own scrolling on an iPhone, whose visual viewport also resizes while
 * scrolling (the toolbars sliding in and out): the page jumped back mid-scroll (third playtest).
 */
import type { Ref } from 'vue'
import { scrollToReveal, scrollToTop, type VerticalBox } from '@/lib/platform/keep-in-view'

function isTouchScreen(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false
}

function visibleArea(): VerticalBox {
  const viewport = window.visualViewport
  if (!viewport) return { top: 0, bottom: window.innerHeight }
  return { top: viewport.offsetTop, bottom: viewport.offsetTop + viewport.height }
}

function coveredEdges(visible: VerticalBox): { top: number; bottom: number } {
  const header = document.querySelector('[data-app-header]')?.getBoundingClientRect()
  const bar = document.querySelector('[data-bottom-bar]')?.getBoundingClientRect()
  return {
    top: header ? Math.max(0, header.bottom - visible.top) : 0,
    bottom: bar && bar.top < visible.bottom ? visible.bottom - bar.top : 0,
  }
}

export function useKeepInView(element: Ref<HTMLElement | null>) {
  function reveal(): void {
    const target = element.value
    if (!target) return
    const visible = visibleArea()
    const box = target.getBoundingClientRect()
    const edges = coveredEdges(visible)
    const distance = isTouchScreen()
      ? scrollToTop(box, visible, edges)
      : scrollToReveal(box, visible, edges)
    if (distance !== 0) window.scrollBy({ top: distance })
  }

  return { reveal }
}
