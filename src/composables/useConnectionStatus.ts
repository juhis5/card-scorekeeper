/**
 * Tracks whether THIS device's network connection has dropped mid-game — distinct from the
 * never-connected → local-game path (already shown as RoomView's persistent offline banner; see
 * the error-ux skill's "the two offline modes: never connected vs blip mid-game"). Firestore's
 * `persistentLocalCache` (see lib/firebase.ts) keeps an online game usable from cache while
 * `isReconnecting` is true, so callers only need a subtle, non-error indicator, never a blocking
 * error state.
 *
 * Deliberately pragmatic (see docs/PLAN.md/DECISIONS.md's slice-5 entry): `navigator.onLine` +
 * the browser's `online`/`offline` events, not a Firestore `onSnapshot` `metadata.fromCache`
 * signal — that would mean threading a "from cache" concept through the mode-agnostic
 * `GameRepository`/`GameState` contract that `LocalGameRepository` shares, for a component that
 * only ever matters online. `navigator.onLine` is also the exact signal `lib/connectivity.ts`'s
 * reachability probe already uses, so this stays consistent with the rest of the app.
 *
 * Every dependency is injectable so this is unit-testable without a real browser (see the tdd
 * skill: no real network/timers) — `RoomView` calls this with no args, using the real `navigator`
 * and `window`.
 */
import { onScopeDispose, ref } from 'vue'

interface ConnectivityEventTarget {
  addEventListener: (type: 'online' | 'offline', listener: () => void) => void
  removeEventListener: (type: 'online' | 'offline', listener: () => void) => void
}

export interface UseConnectionStatusDeps {
  /** Defaults to `navigator.onLine`. Injected so tests never depend on a real browser API. */
  isOnline?: () => boolean
  /** Defaults to the real `window`. Injected so tests can supply a fake event target instead of
   * dispatching real DOM events. */
  eventTarget?: ConnectivityEventTarget
}

export function useConnectionStatus(deps: UseConnectionStatusDeps = {}) {
  const isOnline = deps.isOnline ?? (() => navigator.onLine)
  const eventTarget = deps.eventTarget ?? window

  const isReconnecting = ref(!isOnline())

  function handleOnline(): void {
    isReconnecting.value = false
  }
  function handleOffline(): void {
    isReconnecting.value = true
  }

  eventTarget.addEventListener('online', handleOnline)
  eventTarget.addEventListener('offline', handleOffline)

  onScopeDispose(() => {
    eventTarget.removeEventListener('online', handleOnline)
    eventTarget.removeEventListener('offline', handleOffline)
  })

  return { isReconnecting }
}
