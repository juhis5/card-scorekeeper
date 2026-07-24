import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { useConnectionStatus } from './useConnectionStatus'

/** A fully injectable stand-in for `window`'s online/offline event wiring — deterministic, no
 * real browser events (see the tdd skill: mock the boundary, never real network/timers). */
function makeFakeEventTarget() {
  const listeners: Record<'online' | 'offline', Array<() => void>> = { online: [], offline: [] }
  return {
    addEventListener: (type: 'online' | 'offline', listener: () => void) => {
      listeners[type].push(listener)
    },
    removeEventListener: (type: 'online' | 'offline', listener: () => void) => {
      listeners[type] = listeners[type].filter((registered) => registered !== listener)
    },
    fire(type: 'online' | 'offline'): void {
      listeners[type].forEach((listener) => listener())
    },
    listenerCount(type: 'online' | 'offline'): number {
      return listeners[type].length
    },
  }
}

/** `onScopeDispose` (used for cleanup) only registers inside an active Vue effect scope — the
 * scope a component's `setup()` runs in normally. Runs the composable inside one explicitly,
 * matching how RoomView's `<script setup>` actually invokes it. */
function runInScope<T>(fn: () => T): { result: T; dispose: () => void } {
  const scope = effectScope()
  const result = scope.run(fn) as T
  return { result, dispose: () => scope.stop() }
}

describe('useConnectionStatus, initial state', () => {
  it('is not reconnecting when the device reports online at setup', () => {
    const { result } = runInScope(() =>
      useConnectionStatus({ isOnline: () => true, eventTarget: makeFakeEventTarget() }),
    )

    expect(result.isReconnecting.value).toBe(false)
  })

  it('starts reconnecting when the device already reports offline at setup', () => {
    const { result } = runInScope(() =>
      useConnectionStatus({ isOnline: () => false, eventTarget: makeFakeEventTarget() }),
    )

    expect(result.isReconnecting.value).toBe(true)
  })
})

describe('useConnectionStatus, connectivity events mid-game', () => {
  it('flips to reconnecting when an offline event fires', () => {
    const eventTarget = makeFakeEventTarget()
    const { result } = runInScope(() => useConnectionStatus({ isOnline: () => true, eventTarget }))

    eventTarget.fire('offline')

    expect(result.isReconnecting.value).toBe(true)
  })

  it('flips back to not-reconnecting once an online event fires', () => {
    const eventTarget = makeFakeEventTarget()
    const { result } = runInScope(() => useConnectionStatus({ isOnline: () => true, eventTarget }))

    eventTarget.fire('offline')
    eventTarget.fire('online')

    expect(result.isReconnecting.value).toBe(false)
  })

  it('ignores a redundant online event when already connected', () => {
    const eventTarget = makeFakeEventTarget()
    const { result } = runInScope(() => useConnectionStatus({ isOnline: () => true, eventTarget }))

    eventTarget.fire('online')

    expect(result.isReconnecting.value).toBe(false)
  })
})

describe('useConnectionStatus, cleanup', () => {
  it('stops listening once the owning scope is disposed', () => {
    const eventTarget = makeFakeEventTarget()
    const { result, dispose } = runInScope(() =>
      useConnectionStatus({ isOnline: () => true, eventTarget }),
    )

    dispose()
    eventTarget.fire('offline')

    expect(result.isReconnecting.value).toBe(false)
  })

  it('removes exactly the listeners it added', () => {
    const eventTarget = makeFakeEventTarget()
    const { dispose } = runInScope(() => useConnectionStatus({ isOnline: () => true, eventTarget }))

    dispose()

    expect(eventTarget.listenerCount('online')).toBe(0)
    expect(eventTarget.listenerCount('offline')).toBe(0)
  })
})
