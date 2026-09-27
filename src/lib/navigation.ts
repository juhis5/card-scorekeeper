/**
 * Whether Back can go to the previous screen in this tab. Vue Router's web history records the
 * previous location as `history.state.back`, and leaves it null on the first entry: a room link
 * opened directly, or a new tab. Then Back goes Home instead of leaving the app.
 */
export function hasInAppBack(historyState: unknown): boolean {
  if (typeof historyState !== 'object' || historyState === null) return false
  return typeof (historyState as { back?: unknown }).back === 'string'
}
