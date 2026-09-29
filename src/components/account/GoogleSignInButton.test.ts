import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import GoogleSignInButton from './GoogleSignInButton.vue'
import { i18n, setLocale } from '@/i18n'

beforeEach(() => setLocale('en'))

describe('GoogleSignInButton', () => {
  it("says Google's own words and reports the tap", async () => {
    const { emitted } = render(GoogleSignInButton, { global: { plugins: [i18n] } })

    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))

    expect(emitted('click')).toHaveLength(1)
  })

  it('can be disabled and busy', () => {
    render(GoogleSignInButton, {
      props: { disabled: true, busy: true },
      global: { plugins: [i18n] },
    })

    const button = screen.getByRole('button', { name: 'Sign in with Google' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
  })
})
