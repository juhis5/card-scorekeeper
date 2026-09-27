import { describe, expect, it } from 'vitest'
import { installGuideFor } from './install-guide'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.7258.76 Mobile/15E148 Safari/604.1'
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15'
const IPHONE_IN_APP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0'
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 15; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0'
const DESKTOP_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0'

describe('installGuideFor', () => {
  it('tells Safari on an iPhone to use its Share button', () => {
    expect(installGuideFor({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5 })).toBe('ios-safari')
  })

  it("tells Chrome on an iPhone to use the Share button in its address bar (the tester's case)", () => {
    expect(installGuideFor({ userAgent: IPHONE_CHROME, maxTouchPoints: 5 })).toBe('ios-chrome')
  })

  it("points any other iPhone browser, or an app's own browser, at the browser menu", () => {
    expect(installGuideFor({ userAgent: IPHONE_FIREFOX, maxTouchPoints: 5 })).toBe('ios-other')
    expect(installGuideFor({ userAgent: IPHONE_IN_APP, maxTouchPoints: 5 })).toBe('ios-other')
  })

  it('knows an iPad that calls itself a Mac by its touch screen', () => {
    expect(installGuideFor({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe('ios-safari')
    expect(installGuideFor({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBeNull()
  })

  it('points Android browsers without an install prompt at the browser menu', () => {
    expect(installGuideFor({ userAgent: ANDROID_FIREFOX, maxTouchPoints: 5 })).toBe('android')
  })

  it('has no steps for a desktop browser that cannot install apps', () => {
    expect(installGuideFor({ userAgent: DESKTOP_FIREFOX, maxTouchPoints: 0 })).toBeNull()
  })
})
