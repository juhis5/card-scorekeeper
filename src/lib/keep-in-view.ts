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
