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
  it('shows the current locale code, with an accessible name that contains it', () => {
    render(LocaleToggle, { global: { plugins: [i18n] } })

    const button = screen.getByRole('button', { name: /EN/ })
    expect(button.textContent).toContain('EN')
  })

  it('calls setLocale to switch to Finnish, persisting it and updating <html lang>', async () => {
    render(LocaleToggle, { global: { plugins: [i18n] } })

    await fireEvent.click(screen.getByRole('button', { name: /EN/ }))

    expect(i18n.global.locale.value).toBe('fi')
    expect(document.documentElement.lang).toBe('fi')
    expect(localStorage.getItem('locale')).toBe('fi')
  })

  it('reflects the new current locale after switching, and flips back on a second click', async () => {
    render(LocaleToggle, { global: { plugins: [i18n] } })

    await fireEvent.click(screen.getByRole('button', { name: /EN/ }))
    expect(screen.getByRole('button', { name: /FI/ }).textContent).toContain('FI')

    await fireEvent.click(screen.getByRole('button', { name: /FI/ }))

    expect(i18n.global.locale.value).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('locale')).toBe('en')
  })
})
