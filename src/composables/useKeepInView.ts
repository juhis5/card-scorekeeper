/**
 * Moves an open card clear of the sticky header (`data-app-header`) and a room's bottom bar
 * (`data-bottom-bar`), once, when it opens. Call `reveal()` before focusing the card's field, so
 * the phone's own keyboard scrolling runs last and has the final say.
 *
 * Deliberately not a resize listener. Following window.visualViewport while the keyboard was up
 * fought the player's own scrolling on an iPhone, whose visual viewport also resizes while
 * scrolling (the toolbars sliding in and out): the page jumped back mid-scroll (third playtest).
 */
import type { Ref } from 'vue'
import { scrollToReveal, type VerticalBox } from '@/lib/keep-in-view'

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
    const distance = scrollToReveal(target.getBoundingClientRect(), visible, coveredEdges(visible))
    if (distance !== 0) window.scrollBy({ top: distance })
  }

  return { reveal }
}
