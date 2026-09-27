/**
 * Which install steps to show when the browser has no install prompt of its own (third playtest:
 * installing didn't work on an iPhone with Chrome). Android Chrome and desktop Chromium fire
 * `beforeinstallprompt` and need no steps. No iPhone browser ever does: they all run on WebKit,
 * and there installing is Share → Add to Home Screen, with Share in a different place per browser.
 */

export type InstallGuide = 'ios-safari' | 'ios-chrome' | 'ios-other' | 'android'

export interface DeviceHints {
  userAgent: string
  maxTouchPoints: number
}

/** iPadOS Safari asks for desktop sites, so its user agent says Macintosh: the touch screen tells. */
function isAppleMobile({ userAgent, maxTouchPoints }: DeviceHints): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
}

function appleBrowserGuide(userAgent: string): InstallGuide {
  if (/CriOS\//.test(userAgent)) return 'ios-chrome'
  // Firefox, Edge and the like still say Safari; an app's own browser doesn't say it at all.
  if (/FxiOS\/|EdgiOS\//.test(userAgent) || !/Version\/[\d.]+.*Safari\//.test(userAgent)) {
    return 'ios-other'
  }
  return 'ios-safari'
}

/** `null` when there are no steps to give: a desktop browser that can't install apps. */
export function installGuideFor(hints: DeviceHints): InstallGuide | null {
  if (isAppleMobile(hints)) return appleBrowserGuide(hints.userAgent)
  if (/Android/.test(hints.userAgent)) return 'android'
  return null
}
