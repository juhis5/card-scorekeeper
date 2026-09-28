import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isDarkTheme, paletteClass, parseTheme, THEMES } from './themes'

describe('themes', () => {
  it('reads a stored theme, and falls back to Kapteeni for nothing or anything unknown', () => {
    expect(parseTheme('jani')).toBe('jani')
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme(null)).toBe('captain')
    expect(parseTheme('neon')).toBe('captain')
  })

  it('knows which themes are dark, so dark: styles apply to them too', () => {
    expect(THEMES.filter(isDarkTheme)).toEqual(['captain', 'dark', 'jani', 'nord', 'dracula'])
  })

  it('names a palette class only for themes beyond plain dark and light', () => {
    expect(paletteClass('dark')).toBeNull()
    expect(paletteClass('light')).toBeNull()
    expect(paletteClass('nord')).toBe('theme-nord')
  })

  it("matches index.html's no-flash script, which can't import this list", () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const listIn = (name: string): unknown =>
      JSON.parse(
        (html.match(new RegExp(`var ${name} = (\\[[^\\]]*\\])`))?.[1] ?? '[]')
          .replaceAll("'", '"')
          .replace(/,\s*\]/, ']'),
      )

    expect(listIn('themes')).toEqual([...THEMES])
    expect(listIn('lightThemes')).toEqual(THEMES.filter((theme) => !isDarkTheme(theme)))
  })
})
