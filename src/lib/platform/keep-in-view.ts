/** Scroll distances that keep an element between the sticky header and the bottom bar. An iPhone
 * keyboard shrinks only the visual viewport, not the page, so `visible` is the visual viewport. */

export interface VerticalBox {
  top: number
  bottom: number
}

/** Positive scrolls down, negative up, 0 means it already shows. An element taller than the room
 * left is aligned by its top, where the field and its buttons are. */
export function scrollToReveal(
  element: VerticalBox,
  visible: VerticalBox,
  margins: { top: number; bottom: number },
): number {
  const roomTop = visible.top + margins.top
  const roomBottom = visible.bottom - margins.bottom
  if (element.top < roomTop) return element.top - roomTop
  if (element.bottom <= roomBottom) return 0
  return Math.min(element.bottom - roomBottom, element.top - roomTop)
}

/** In px. */
const GAP_UNDER_HEADER = 8

/** An opening card goes just under the header before its field is focused, so the keyboard, which
 * only covers the lower screen, never hides the field. */
export function scrollToTop(
  element: VerticalBox,
  visible: VerticalBox,
  margins: { top: number },
): number {
  return element.top - (visible.top + margins.top + GAP_UNDER_HEADER)
}
