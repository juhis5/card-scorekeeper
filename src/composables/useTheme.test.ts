import { beforeEach, describe, expect, it } from 'vitest'
import { useTheme } from './useTheme'

/** Asserts the exact contract with index.html's inline no-flash script:
 * `(localStorage.getItem('theme') ?? 'dark') === 'dark'`. */
function hasDarkClass(): boolean {
  return document.documentElement.classList.contains('dark')
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('useTheme', () => {
  it('defaults to dark when nothing is stored, matching the no-flash script', () => {
    const { theme } = useTheme()

    expect(theme.value).toBe('dark')
    expect(hasDarkClass()).toBe(true)
  })

  it('reads a stored light preference and does not apply the dark class', () => {
    localStorage.setItem('theme', 'light')

    const { theme } = useTheme()

    expect(theme.value).toBe('light')
    expect(hasDarkClass()).toBe(false)
  })

  it('reads a stored dark preference and applies the dark class', () => {
    localStorage.setItem('theme', 'dark')

    const { theme } = useTheme()

    expect(theme.value).toBe('dark')
    expect(hasDarkClass()).toBe(true)
  })

  it('treats an unexpected stored value as light, exactly like the no-flash script', () => {
    localStorage.setItem('theme', 'banana')

    const { theme } = useTheme()

    expect(theme.value).toBe('light')
    expect(hasDarkClass()).toBe(false)
  })

  it('toggleTheme flips dark to light, updates the class, and persists the choice', () => {
    localStorage.setItem('theme', 'dark')
    const { theme, toggleTheme } = useTheme()

    toggleTheme()

    expect(theme.value).toBe('light')
    expect(hasDarkClass()).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('toggleTheme flips light to dark, updates the class, and persists the choice', () => {
    localStorage.setItem('theme', 'light')
    const { theme, toggleTheme } = useTheme()

    toggleTheme()

    expect(theme.value).toBe('dark')
    expect(hasDarkClass()).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('setTheme sets an explicit value regardless of the current one', () => {
    const { theme, setTheme } = useTheme()

    setTheme('light')

    expect(theme.value).toBe('light')
    expect(hasDarkClass()).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
  })
})
