/**
 * How far to scroll so an element shows between the sticky header and the bottom action bar,
 * within the part of the page that's actually visible. On an iPhone the keyboard doesn't resize
 * the page, only that visible part, so `visible` comes from window.visualViewport. Pure.
 */

export interface VerticalBox {
  top: number
  bottom: number
}

/** A positive result scrolls down, a negative one up, 0 means it already shows. An element taller
 * than the room left is aligned by its top, where the field and its buttons are. */
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

/** A little air between the header and the element brought up under it, in px. */
const GAP_UNDER_HEADER = 8

/** How far to scroll so the element sits just under the header. On a phone an opening card goes
 * there before its field is focused, so the keyboard, which only ever covers the lower part of
 * the screen, never covers the field. */
export function scrollToTop(
  element: VerticalBox,
  visible: VerticalBox,
  margins: { top: number },
): number {
  return element.top - (visible.top + margins.top + GAP_UNDER_HEADER)
}
