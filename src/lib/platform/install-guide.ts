/**
 * Install steps for browsers without an install prompt. Android Chrome and desktop Chromium fire
 * `beforeinstallprompt`. No iPhone browser does: all run on WebKit, where installing is Share →
 * Add to Home Screen, and each browser puts Share somewhere else.
 */

export type InstallGuide = 'ios-safari' | 'ios-chrome' | 'ios-other' | 'android'

export interface DeviceHints {
  userAgent: string
  maxTouchPoints: number
}

/** iPadOS Safari's user agent says Macintosh, so the touch screen tells it apart. */
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
