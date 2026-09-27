import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import ThemeToggle from './ThemeToggle.vue'
import { i18n } from '@/i18n'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('ThemeToggle', () => {
  it('is a switch named by its row, on for the dark default', () => {
    render(ThemeToggle, { global: { plugins: [i18n] } })

    const toggle = screen.getByRole('switch', { name: 'Dark mode' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('is off for a stored light preference', () => {
    localStorage.setItem('theme', 'light')

    render(ThemeToggle, { global: { plugins: [i18n] } })

    expect(screen.getByRole('switch', { name: 'Dark mode' }).getAttribute('aria-checked')).toBe(
      'false',
    )
  })

  it('flips the theme and persists it when the row is tapped, not only the switch', async () => {
    render(ThemeToggle, { global: { plugins: [i18n] } })
    const toggle = screen.getByRole('switch', { name: 'Dark mode' })

    await fireEvent.click(screen.getByText('Dark mode'))

    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')

    await fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
  })
})
