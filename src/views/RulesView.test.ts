import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/vue'
import RulesView from './RulesView.vue'
import { i18n, setLocale } from '@/i18n'
import { ACE_VALUE, CONTRACTS, JOKER_VALUE, LOW_NUMBER_CARD_VALUE } from '@/lib/game/rules'

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
})

function renderRules() {
  render(RulesView, { global: { plugins: [i18n] } })
}

describe('RulesView', () => {
  it('lists the five contracts in order', () => {
    renderRules()

    const rounds = within(screen.getByRole('region', { name: 'Rounds' })).getAllByRole('listitem')
    expect(rounds).toHaveLength(CONTRACTS.length)
    expect(rounds[0]?.textContent).toContain('Two sets of three')
    expect(rounds[4]?.textContent).toContain('Two flushes and one set of three')
  })

  it("shows each card's value from the scoring itself", () => {
    renderRules()

    expect(screen.getByRole('row', { name: '2–9 5 pts' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'Ace' }).nextElementSibling?.textContent).toBe(
      `${ACE_VALUE} pts`,
    )
    expect(screen.getByRole('rowheader', { name: 'Joker' }).nextElementSibling?.textContent).toBe(
      `${JOKER_VALUE} pts`,
    )
    expect(LOW_NUMBER_CARD_VALUE).toBe(5)
  })

  it('draws the example melds as named cards, and marks the one that does not count', () => {
    renderRules()

    expect(screen.getAllByRole('img', { name: 'seven of hearts' })).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'joker' })).toBeTruthy()
    const noWrap = screen.getByText(/never runs from king through ace to two/).closest('li')
    expect(noWrap?.textContent).toContain("doesn't count")
    expect(within(noWrap as HTMLElement).getByRole('img', { name: 'king of hearts' })).toBeTruthy()
  })

  it('names the cards in Finnish too', () => {
    setLocale('fi')
    renderRules()

    expect(screen.getAllByRole('img', { name: 'hertta seitsemän' })).toHaveLength(2)
  })
})
