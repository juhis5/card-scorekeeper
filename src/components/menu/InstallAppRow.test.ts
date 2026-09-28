import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fireEvent, render, screen } from '@testing-library/vue'
import InstallAppRow from './InstallAppRow.vue'
import { i18n, setLocale } from '@/i18n'
import { useInstallStore, type InstallTarget } from '@/stores/install'

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.7258.76 Mobile/15E148 Safari/604.1'

function fakeWindow(userAgent: string): InstallTarget {
  return Object.assign(new EventTarget(), {
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent, maxTouchPoints: 5 },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  setLocale('en')
})

describe('InstallAppRow', () => {
  it("opens the browser's own install prompt where there is one", async () => {
    const target = fakeWindow(ANDROID_CHROME)
    useInstallStore().listen(target)
    const prompt = vi.fn().mockResolvedValue(undefined)
    target.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt }),
    )
    render(InstallAppRow, { global: { plugins: [i18n] } })

    const row = screen.getByRole('button', { name: 'Install the app' })
    expect(row.hasAttribute('aria-expanded')).toBe(false)
    await fireEvent.click(row)

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('shows Chrome on an iPhone where its Share button is, then Add to Home Screen', async () => {
    useInstallStore().listen(fakeWindow(IPHONE_CHROME))
    render(InstallAppRow, { global: { plugins: [i18n] } })

    const row = screen.getByRole('button', { name: 'Install the app' })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    await fireEvent.click(row)

    expect(row.getAttribute('aria-expanded')).toBe('true')
    const steps = screen.getAllByRole('listitem').map((step) => step.textContent)
    expect(steps).toEqual([
      'Tap Share (the square with an arrow) at the right end of the address bar.',
      'Choose Add to Home Screen.',
    ])

    await fireEvent.click(row)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
