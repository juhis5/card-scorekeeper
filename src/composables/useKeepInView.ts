/**
 * Keeps an open card showing above the phone keyboard. While `isActive`, it re-checks whenever the
 * visible part of the page changes size (the keyboard opening, or the phone turning) and scrolls
 * the page just enough; `reveal()` does it once on demand. On an iPhone the keyboard shrinks only
 * window.visualViewport, not the page, so that's what counts as visible. The sticky header
 * (`data-app-header`) and a room's bottom bar (`data-bottom-bar`) cover part of it when they're in
 * view; on an iPhone with the keyboard up the bar sits behind the keyboard and covers nothing.
 */
import { watch, type Ref } from 'vue'
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

export function useKeepInView(element: Ref<HTMLElement | null>, isActive: Ref<boolean>) {
  function reveal(): void {
    const target = element.value
    if (!target) return
    const visible = visibleArea()
    const distance = scrollToReveal(target.getBoundingClientRect(), visible, coveredEdges(visible))
    if (distance !== 0) window.scrollBy({ top: distance })
  }

  watch(
    isActive,
    (active, _previous, onCleanup) => {
      if (!active) return
      const source = window.visualViewport ?? window
      source.addEventListener('resize', reveal)
      onCleanup(() => source.removeEventListener('resize', reveal))
    },
    { immediate: true },
  )

  return { reveal }
}
