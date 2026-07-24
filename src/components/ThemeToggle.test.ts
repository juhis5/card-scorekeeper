import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import ThemeToggle from './ThemeToggle.vue'
import { i18n } from '@/i18n'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('ThemeToggle', () => {
  it('reflects the dark default as pressed, with a stable accessible name', () => {
    render(ThemeToggle, { global: { plugins: [i18n] } })

    const button = screen.getByRole('button', { name: 'Dark mode' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('reflects a stored light preference as not pressed', () => {
    localStorage.setItem('theme', 'light')

    render(ThemeToggle, { global: { plugins: [i18n] } })

    const button = screen.getByRole('button', { name: 'Dark mode' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('toggles the dark class, persists the choice, and flips the pressed state on click', async () => {
    render(ThemeToggle, { global: { plugins: [i18n] } })
    const button = screen.getByRole('button', { name: 'Dark mode' })

    await fireEvent.click(button)

    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')

    await fireEvent.click(button)

    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('is keyboard-operable as a native button (no custom key handling needed)', () => {
    render(ThemeToggle, { global: { plugins: [i18n] } })

    const button = screen.getByRole('button', { name: 'Dark mode' })
    // A real <button> gets Enter/Space activation and focus for free — assert the element is
    // actually a native button rather than a styled div standing in for one.
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
  })
})
