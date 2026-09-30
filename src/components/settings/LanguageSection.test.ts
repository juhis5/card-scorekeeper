import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import LanguageSection from './LanguageSection.vue'
import { i18n } from '@/i18n'

beforeEach(() => {
  localStorage.clear()
  i18n.global.locale.value = 'en'
  document.documentElement.lang = 'en'
})

describe('LanguageSection', () => {
  it('names each language in itself, the current one chosen', () => {
    render(LanguageSection, { global: { plugins: [i18n] } })

    expect(screen.getByRole('heading', { name: 'Language' })).toBeTruthy()
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      'fi',
      'en',
    ])
    expect(screen.getByRole('radio', { name: 'English' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Suomi' }).getAttribute('aria-checked')).toBe('false')
  })

  it('switches to Finnish, persisting it and updating <html lang>', async () => {
    render(LanguageSection, { global: { plugins: [i18n] } })

    await fireEvent.click(screen.getByRole('radio', { name: 'Suomi' }))

    expect(i18n.global.locale.value).toBe('fi')
    expect(document.documentElement.lang).toBe('fi')
    expect(localStorage.getItem('locale')).toBe('fi')
    expect(screen.getByRole('heading', { name: 'Kieli' })).toBeTruthy()
  })
})
