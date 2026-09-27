import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import ThemePicker from './ThemePicker.vue'
import { i18n, setLocale } from '@/i18n'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  setLocale('en')
})

async function openPicker(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: /^Theme/ }))
}

describe('ThemePicker', () => {
  it('names the current theme, and lists every theme when opened', async () => {
    render(ThemePicker, { global: { plugins: [i18n] } })

    const row = screen.getByRole('button', { name: /^Theme\s+Dark/ })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    await openPicker()

    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      'dark',
      'light',
      'jani',
      'nord',
      'dracula',
      'solarized',
    ])
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true')
  })

  it('switches the theme, persists it and names the new one', async () => {
    render(ThemePicker, { global: { plugins: [i18n] } })
    await openPicker()

    await fireEvent.click(screen.getByRole('radio', { name: 'Jani' }))

    expect(document.documentElement.classList.contains('theme-jani')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('jani')
    expect(screen.getByRole('button', { name: /^Theme\s+Jani/ })).toBeTruthy()
  })
})
