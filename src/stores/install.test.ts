import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstallStore, type InstallTarget } from './install'

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.7258.76 Mobile/15E148 Safari/604.1'
const DESKTOP_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0'

/** A stand-in for `window`: its own event target, so no listener outlives a test. */
function fakeWindow({ userAgent = ANDROID_CHROME, isStandalone = false } = {}): InstallTarget {
  return Object.assign(new EventTarget(), {
    matchMedia: () => ({ matches: isStandalone }),
    navigator: { userAgent, maxTouchPoints: 5 },
  })
}

/** The browser's install prompt, as Chrome fires it. */
function installPromptEvent() {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useInstallStore', () => {
  it("keeps the browser's install prompt for the menu instead of letting the browser show it", () => {
    const target = fakeWindow()
    const install = useInstallStore()
    install.listen(target)
    const event = installPromptEvent()

    target.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(install.canPrompt).toBe(true)
    expect(install.isAvailable).toBe(true)
  })

  it('shows the prompt once, then no more', async () => {
    const target = fakeWindow()
    const install = useInstallStore()
    install.listen(target)
    const event = installPromptEvent()
    target.dispatchEvent(event)

    await install.promptInstall()

    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(install.canPrompt).toBe(false)
  })

  it('offers the steps on an iPhone, where no browser has an install prompt', () => {
    const install = useInstallStore()

    install.listen(fakeWindow({ userAgent: IPHONE_CHROME }))

    expect(install.canPrompt).toBe(false)
    expect(install.guide).toBe('ios-chrome')
    expect(install.isAvailable).toBe(true)
  })

  it('offers nothing where there is no way to install', () => {
    const install = useInstallStore()

    install.listen(fakeWindow({ userAgent: DESKTOP_FIREFOX }))

    expect(install.isAvailable).toBe(false)
  })

  it('offers nothing once the app runs installed, or right after it has been installed', () => {
    const installed = useInstallStore()
    installed.listen(fakeWindow({ userAgent: IPHONE_CHROME, isStandalone: true }))
    expect(installed.isAvailable).toBe(false)

    setActivePinia(createPinia())
    const target = fakeWindow()
    const install = useInstallStore()
    install.listen(target)
    target.dispatchEvent(installPromptEvent())
    target.dispatchEvent(new Event('appinstalled'))

    expect(install.isAvailable).toBe(false)
  })
})
