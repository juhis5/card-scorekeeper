/** Vue Router leaves `history.state.back` null on a tab's first entry (a room link opened
 * directly), and then Back goes Home instead of leaving the app. */
export function hasInAppBack(historyState: unknown): boolean {
  if (typeof historyState !== 'object' || historyState === null) return false
  return typeof (historyState as { back?: unknown }).back === 'string'
}
