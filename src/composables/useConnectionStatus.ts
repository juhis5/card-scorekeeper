/**
 * Whether the connection dropped mid-game, from `navigator.onLine` and its events (snapshot
 * metadata would leak Firestore into `GameRepository`). Firestore's cache keeps the game usable
 * meanwhile, so callers show a quiet notice, not an error.
 */
import { onScopeDispose, ref } from 'vue'

interface ConnectivityEventTarget {
  addEventListener: (type: 'online' | 'offline', listener: () => void) => void
  removeEventListener: (type: 'online' | 'offline', listener: () => void) => void
}

export interface UseConnectionStatusDeps {
  /** Defaults to `navigator.onLine`. */
  isOnline?: () => boolean
  /** Defaults to `window`. */
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
