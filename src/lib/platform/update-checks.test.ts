import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { checkForUpdatesRegularly, UPDATE_CHECK_INTERVAL_MS } from './update-checks'

function fakePage({ visible = true, online = true } = {}) {
  const page = Object.assign(new EventTarget(), { visibilityState: visible ? 'visible' : 'hidden' })
  return { page, isOnline: () => online }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('checkForUpdatesRegularly', () => {
  it('asks for a new version every so often, not only on a cold start', () => {
    const registration = { update: vi.fn().mockResolvedValue(undefined) }
    const { page, isOnline } = fakePage()
    checkForUpdatesRegularly(registration, { page, isOnline })

    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 2)

    expect(registration.update).toHaveBeenCalledTimes(2)
  })

  it('asks as soon as the app comes back to the screen', () => {
    const registration = { update: vi.fn().mockResolvedValue(undefined) }
    const { page, isOnline } = fakePage()
    checkForUpdatesRegularly(registration, { page, isOnline })

    page.dispatchEvent(new Event('visibilitychange'))

    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('skips a check while offline or out of sight, and stops when told to', () => {
    const registration = { update: vi.fn().mockResolvedValue(undefined) }
    const offline = fakePage({ online: false })
    const hidden = fakePage({ visible: false })
    checkForUpdatesRegularly(registration, offline)
    checkForUpdatesRegularly(registration, hidden)
    const { page, isOnline } = fakePage()
    const stop = checkForUpdatesRegularly(registration, { page, isOnline })

    stop()
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
    page.dispatchEvent(new Event('visibilitychange'))

    expect(registration.update).not.toHaveBeenCalled()
  })

  it('shrugs off a check that fails, and tries again next time', async () => {
    const registration = { update: vi.fn().mockRejectedValue(new Error('offline')) }
    const { page, isOnline } = fakePage()
    checkForUpdatesRegularly(registration, { page, isOnline })

    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 2)
    await Promise.resolve()

    expect(registration.update).toHaveBeenCalledTimes(2)
  })
})

describe('checkForUpdatesRegularly, on the real page', () => {
  it('watches the document and the device connection when none are given', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const registration = { update: vi.fn().mockResolvedValue(undefined) }
    onTestFinished(checkForUpdatesRegularly(registration))

    document.dispatchEvent(new Event('visibilitychange'))

    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('skips a check while the device reports it is offline', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const registration = { update: vi.fn().mockResolvedValue(undefined) }
    onTestFinished(checkForUpdatesRegularly(registration))

    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)

    expect(registration.update).not.toHaveBeenCalled()
  })

  it('stops listening to the document when told to', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const registration = { update: vi.fn().mockResolvedValue(undefined) }
    const stop = checkForUpdatesRegularly(registration)

    stop()
    document.dispatchEvent(new Event('visibilitychange'))

    expect(registration.update).not.toHaveBeenCalled()
  })
})
