/**
 * Whether Back can go to the previous screen in this tab. Vue Router's web history records the
 * previous location as `history.state.back`, and leaves it null on the first entry: a room link
 * opened directly, or a new tab. Then Back goes Home instead of leaving the app.
 */
export function hasInAppBack(historyState: unknown): boolean {
  if (typeof historyState !== 'object' || historyState === null) return false
  return typeof (historyState as { back?: unknown }).back === 'string'
}

/**
 * Play again after a local game hands the finished game's names, host first, to the setup form
 * through the history entry (Vue Router's `state`), so the host can add or remove players before
 * starting and a reload keeps them. Null when Home wasn't opened that way.
 */
export function playAgainNamesFrom(historyState: unknown): string[] | null {
  if (typeof historyState !== 'object' || historyState === null) return null
  const names = (historyState as { playAgainNames?: unknown }).playAgainNames
  if (!Array.isArray(names) || names.length === 0) return null
  return names.every((name) => typeof name === 'string') ? names : null
}
