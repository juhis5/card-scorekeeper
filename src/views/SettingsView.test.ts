import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import SettingsView from './SettingsView.vue'
import { i18n, setLocale } from '@/i18n'

beforeEach(() => setLocale('en'))

describe('SettingsView', () => {
  it('holds the language and the theme under the page heading', () => {
    render(SettingsView, { global: { plugins: [i18n] } })

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Language' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Theme' })).toBeTruthy()
  })
})
