import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserLocalStorage } from './key-value-storage'

/** Like Chrome with "block sites from saving data": even reading `localStorage` throws. */
function blockSiteData(): void {
  vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Access is denied', 'SecurityError')
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('browserLocalStorage', () => {
  it('reads and writes the real localStorage', () => {
    browserLocalStorage().setItem('probe', 'yes')

    expect(localStorage.getItem('probe')).toBe('yes')
    expect(browserLocalStorage().getItem('probe')).toBe('yes')
  })

  it('finds nothing and drops writes when site data is blocked, instead of throwing', () => {
    blockSiteData()

    expect(browserLocalStorage().getItem('locale')).toBeNull()
    expect(() => browserLocalStorage().setItem('locale', 'fi')).not.toThrow()
  })

  it('lets the app start with blocked site data: the language comes from the device', async () => {
    blockSiteData()
    vi.resetModules()

    const { i18n } = await import('@/i18n')

    expect(['en', 'fi']).toContain(i18n.global.locale.value)
  })
})
