import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import ThemeSection from './ThemeSection.vue'
import { i18n, setLocale } from '@/i18n'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  setLocale('en')
})

describe('ThemeSection', () => {
  it('lists every theme at once, the current one chosen', () => {
    render(ThemeSection, { global: { plugins: [i18n] } })

    expect(screen.getByRole('heading', { name: 'Theme' })).toBeTruthy()
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      'captain',
      'captain-light',
      'dark',
      'light',
      'jani',
      'nord',
      'dracula',
      'solarized',
    ])
    expect(screen.getByRole('radio', { name: 'Captain' }).getAttribute('aria-checked')).toBe('true')
  })

  it('switches the theme and persists it', async () => {
    render(ThemeSection, { global: { plugins: [i18n] } })

    await fireEvent.click(screen.getByRole('radio', { name: 'Nord' }))

    expect(document.documentElement.classList.contains('theme-nord')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('nord')
    expect(screen.getByRole('radio', { name: 'Nord' }).getAttribute('aria-checked')).toBe('true')
  })
})
