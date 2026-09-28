import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const confettiMock = vi.fn()
vi.mock('canvas-confetti', () => ({ default: (...args: unknown[]) => confettiMock(...args) }))

const { celebrate, BURSTS } = await import('./celebrate')

function preferReducedMotion(isReduced: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: isReduced && query.includes('reduce') }) as MediaQueryList,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  confettiMock.mockReset()
  document.documentElement.style.setProperty('--primary', '#e0b04a')
  document.documentElement.style.setProperty('--brand', '#b3261e')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('style')
})

describe('celebrate', () => {
  it('fires a volley of bursts in the theme colours, each from its own spot', async () => {
    preferReducedMotion(false)

    await celebrate()
    await vi.runAllTimersAsync()

    expect(confettiMock).toHaveBeenCalledTimes(BURSTS)
    const first = confettiMock.mock.calls[0]?.[0]
    expect(first).toMatchObject({
      colors: ['#e0b04a', '#b3261e'],
      disableForReducedMotion: true,
    })
    const origins = confettiMock.mock.calls.map((call) => JSON.stringify(call[0].origin))
    expect(new Set(origins).size).toBe(BURSTS)
  })

  it('does nothing, without even loading the effect, when the phone asks for less motion', async () => {
    preferReducedMotion(true)

    await celebrate()
    await vi.runAllTimersAsync()

    expect(confettiMock).not.toHaveBeenCalled()
  })

  it('falls back to its own colours when the theme sets none', async () => {
    preferReducedMotion(false)
    document.documentElement.removeAttribute('style')

    await celebrate()
    await vi.runAllTimersAsync()

    expect(confettiMock.mock.calls[0]?.[0].colors.length).toBeGreaterThan(0)
  })
})
