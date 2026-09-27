/**
 * Places a card as it opens. On touch it goes just under the sticky header, since a phone won't
 * scroll a field focused from code out from behind its keyboard. No resize listener: an iPhone's
 * viewport also resizes while scrolling, so following it fought the player's own scrolling.
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
