import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import LocaleToggle from './LocaleToggle.vue'
import { i18n } from '@/i18n'

beforeEach(() => {
  localStorage.clear()
  i18n.global.locale.value = 'en'
  document.documentElement.lang = 'en'
})

describe('LocaleToggle', () => {
  it('is one row naming the setting and the current language, with a hint that a tap switches it', () => {
    render(LocaleToggle, { global: { plugins: [i18n] } })

    const row = screen.getByRole('button', { name: /^Language\s+English\s*, tap to switch$/ })
    expect(row.textContent).toContain('English')
  })

  it('switches to Finnish, persisting it and updating <html lang>', async () => {
    render(LocaleToggle, { global: { plugins: [i18n] } })

    await fireEvent.click(screen.getByRole('button', { name: /Language/ }))

    expect(i18n.global.locale.value).toBe('fi')
    expect(document.documentElement.lang).toBe('fi')
    expect(localStorage.getItem('locale')).toBe('fi')
    expect(screen.getByRole('button', { name: /^Kieli\s+Suomi/ })).toBeTruthy()
  })

  it('flips back on a second tap', async () => {
    render(LocaleToggle, { global: { plugins: [i18n] } })

    await fireEvent.click(screen.getByRole('button', { name: /Language/ }))
    await fireEvent.click(screen.getByRole('button', { name: /Kieli/ }))

    expect(i18n.global.locale.value).toBe('en')
    expect(localStorage.getItem('locale')).toBe('en')
  })
})
