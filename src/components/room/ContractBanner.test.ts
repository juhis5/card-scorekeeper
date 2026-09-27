import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import ContractBanner from './ContractBanner.vue'
import { i18n } from '@/i18n'

describe('ContractBanner', () => {
  it('shows the current round and its contract text', () => {
    render(ContractBanner, {
      props: { round: 3, contractKey: 'contract.round3' },
      global: { plugins: [i18n] },
    })

    const banner = screen.getByText(/Round 3 of 5/).textContent ?? ''
    expect(banner).toContain('Round 3 of 5')
    expect(banner).toContain('Three sets of three')
  })

  it('updates when a different round and contract are given', () => {
    render(ContractBanner, {
      props: { round: 5, contractKey: 'contract.round5' },
      global: { plugins: [i18n] },
    })

    const banner = screen.getByText(/Round 5 of 5/).textContent ?? ''
    expect(banner).toContain('Round 5 of 5')
    expect(banner).toContain('Two flushes and one set of three')
  })

  it('is not a live region: the room view announces the new round with the results', () => {
    render(ContractBanner, {
      props: { round: 2, contractKey: 'contract.round2' },
      global: { plugins: [i18n] },
    })

    expect(screen.queryByRole('status')).toBeNull()
  })
})
