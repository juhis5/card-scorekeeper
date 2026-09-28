/** The finish's fireworks: a short volley of bursts in the theme's colours. Skipped when the phone
 * asks for reduced motion, and the effect only loads when a game is won. */

/** How far apart the bursts go off (ms): about two seconds in all. */
const BURST_GAP_MS = 350

/** Gold and red, in case a theme sets neither token. */
const FALLBACK_COLOURS = ['#e0b04a', '#b3261e']

/** Where each burst goes off, as a share of the screen: spread out, mostly high up. */
const ORIGINS = [
  { x: 0.2, y: 0.35 },
  { x: 0.8, y: 0.3 },
  { x: 0.5, y: 0.2 },
  { x: 0.3, y: 0.5 },
  { x: 0.7, y: 0.45 },
  { x: 0.5, y: 0.35 },
]

export const BURSTS = ORIGINS.length

function themeColours(): string[] {
  const style = getComputedStyle(document.documentElement)
  const colours = ['--primary', '--brand']
    .map((token) => style.getPropertyValue(token).trim())
    .filter((value) => value !== '')
  return colours.length > 0 ? colours : FALLBACK_COLOURS
}

export async function celebrate(): Promise<void> {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const { default: confetti } = await import('canvas-confetti')
  const colors = themeColours()
  ORIGINS.forEach((origin, index) => {
    setTimeout(() => {
      void confetti({
        origin,
        colors,
        particleCount: 60,
        spread: 360,
        startVelocity: 28,
        gravity: 0.9,
        ticks: 180,
        scalar: 0.9,
        disableForReducedMotion: true,
      })
    }, index * BURST_GAP_MS)
  })
}
