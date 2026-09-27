// @vitest-environment node
/**
 * Enforces WCAG AA contrast for the theme tokens in main.css, in every theme: 4.5:1 for text,
 * 3:1 for the focus ring (a non-text indicator). Reads the real stylesheet, so a token edit that
 * breaks contrast fails here instead of shipping.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const TEXT_MINIMUM = 4.5
const NON_TEXT_MINIMUM = 3
/** Matches `outline-ring/80` in main.css and `ring-ring/80` in the shadcn button and input. */
const RING_OPACITY = 0.8

// Node environment: CSS imports resolve to an empty string under happy-dom, even with `?raw`.
const css = readFileSync(new URL('./main.css', import.meta.url), 'utf8')

function tokensOf(selector: string): Record<string, string> {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const blocks = [...uncommented.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const block = blocks.find(
    ([, head, body]) =>
      head?.replace(/\s+/g, ' ').trim() === selector && body?.includes('--primary:'),
  )
  if (!block?.[2]) throw new Error(`no theme block for ${selector} in main.css`)
  return Object.fromEntries(
    [...block[2].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, value]) => [
      name,
      value,
    ]),
  )
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16))
}

function relativeLuminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = channels(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  )
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)
}

/** The colour a translucent foreground actually shows over an opaque background. */
function composite(foreground: string, background: string, opacity: number): string {
  const back = channels(background)
  const mixed = channels(foreground).map((channel, index) =>
    Math.round(opacity * channel + (1 - opacity) * (back[index] ?? 0)),
  )
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** Text colours and the surfaces the app actually puts them on. */
const TEXT_PAIRS: [text: string, surface: string][] = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['foreground', 'muted'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['primary', 'background'],
  ['primary', 'card'],
  ['primary', 'muted'],
  ['primary-foreground', 'primary'],
  ['destructive', 'background'],
  ['destructive', 'card'],
]

describe.each([
  ['light', ':root, .theme-light'],
  ['dark', '.dark'],
  ['jani', '.theme-jani'],
  ['nord', '.theme-nord'],
  ['dracula', '.theme-dracula'],
  ['solarized', '.theme-solarized'],
])('%s theme contrast', (_theme, selector) => {
  const tokens = tokensOf(selector)
  const token = (name: string): string => {
    const value = tokens[name]
    if (!value) throw new Error(`missing --${name} in ${selector}`)
    return value
  }

  it.each(TEXT_PAIRS)('%s text on %s meets 4.5:1', (text, surface) => {
    expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(TEXT_MINIMUM)
  })

  it.each(['background', 'card', 'muted'])('the focus ring on %s meets 3:1', (surface) => {
    const ring = composite(token('ring'), token(surface), RING_OPACITY)
    expect(contrast(ring, token(surface))).toBeGreaterThanOrEqual(NON_TEXT_MINIMUM)
  })
})
