import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import PrivacyView from './PrivacyView.vue'
import { i18n, setLocale } from '@/i18n'

beforeEach(() => {
  setLocale('en')
})

describe('PrivacyView', () => {
  it('says what is public and where the data goes', () => {
    render(PrivacyView, { global: { plugins: [i18n] } })

    expect(screen.getByRole('heading', { level: 1, name: 'Privacy' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Highscores are public' })).toBeTruthy()
    expect(screen.getByText(/europe-north1/)).toBeTruthy()
    expect(screen.getByText(/Sentry in the EU/)).toBeTruthy()
  })

  it('reads in Finnish too', () => {
    setLocale('fi')
    render(PrivacyView, { global: { plugins: [i18n] } })

    expect(screen.getByRole('heading', { level: 1, name: 'Tietosuoja' })).toBeTruthy()
  })
})
