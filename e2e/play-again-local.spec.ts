/**
 * Play again after a local game (tester note 7) opens the setup form with the same names, so the
 * host can add or remove players first. One device only, so this also runs on WebKit.
 */
import { expect, test } from '@playwright/test'
import { enterRoundScore, hostForm, roundHeading } from './helpers'

test.describe('play again, local game', () => {
  test('opens the setup form with the same names, and starts from it right away', async ({
    page,
  }) => {
    // The emulators are unreachable from this page, so hosting falls back to a local game.
    await page.route(/localhost:(8280|9299)/, (route) => route.abort())
    await page.goto('/')
    await hostForm(page).getByLabel('Your name', { exact: true }).fill('Host')
    await hostForm(page).getByLabel('Player 1 name').fill('Alice')
    await hostForm(page).getByRole('button', { name: 'Start game' }).click()
    await expect(roundHeading(page, 1)).toBeVisible()

    for (let round = 1; round <= 5; round++) {
      await enterRoundScore(page, 'Host', round, 20)
      await enterRoundScore(page, 'Alice', round, 10)
      await page.getByRole('button', { name: round < 5 ? 'Next round' : 'Finish game' }).click()
    }
    await expect(page.getByText('Alice wins!')).toBeVisible()

    await page.getByRole('button', { name: 'Play again' }).click()

    await expect(hostForm(page).getByLabel('Your name', { exact: true })).toHaveValue('Host')
    await expect(hostForm(page).getByLabel('Player 1 name')).toHaveValue('Alice')

    // The finished game is still saved on this device, but only an unfinished one asks first.
    await hostForm(page).getByRole('button', { name: 'Start game' }).click()
    await expect(roundHeading(page, 1)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Keep playing' })).toHaveCount(0)
  })
})
