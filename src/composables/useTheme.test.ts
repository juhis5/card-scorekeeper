import { beforeEach, describe, expect, it } from 'vitest'
import { applyStoredTheme, useTheme } from './useTheme'

function rootClasses(): string[] {
  return [...document.documentElement.classList]
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  document.head.innerHTML = '<meta name="theme-color" content="#000000" />'
})

describe('useTheme', () => {
  it('defaults to dark when nothing is stored, like the no-flash script', () => {
    const { theme } = useTheme()

    expect(theme.value).toBe('dark')
    expect(rootClasses()).toEqual(['dark'])
  })

  it('treats an unknown stored value as the default, like the no-flash script', () => {
    localStorage.setItem('theme', 'banana')

    expect(useTheme().theme.value).toBe('dark')
  })

  it('applies a light theme without the dark class', () => {
    localStorage.setItem('theme', 'light')

    useTheme()

    expect(rootClasses()).toEqual([])
  })

  it('switches to a named palette, persists it, and drops the one before', () => {
    const { theme, setTheme } = useTheme()

    setTheme('solarized')
    expect(rootClasses()).toEqual(['theme-solarized'])

    setTheme('jani')
    expect(theme.value).toBe('jani')
    expect(rootClasses().sort()).toEqual(['dark', 'theme-jani'])
    expect(localStorage.getItem('theme')).toBe('jani')
  })

  it("gives the browser's theme color the theme's own background", () => {
    document.documentElement.style.setProperty('--background', '#2d2d2d')

    applyStoredTheme()

    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#2d2d2d',
    )
    document.documentElement.style.removeProperty('--background')
  })
})
