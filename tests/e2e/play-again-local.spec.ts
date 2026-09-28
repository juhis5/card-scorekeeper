/**
 * Play again after a local game starts the next game at once with the same players; the host adds
 * or removes players in the room. One device only, so this also runs on WebKit.
 */
import { expect, test } from '@playwright/test'
import { enterRoundScore, roundHeading, startLocalGame, winnerBanner } from './helpers'

test.describe('play again, local game', () => {
  test('starts the next game at once, with the same players', async ({ page }) => {
    await startLocalGame(page, 'Host', ['Alice'])

    for (let round = 1; round <= 5; round++) {
      await enterRoundScore(page, 'Host', round, 20)
      await enterRoundScore(page, 'Alice', round, 0)
      await page.getByRole('button', { name: round < 5 ? 'Next round' : 'Finish game' }).click()
    }
    await expect(winnerBanner(page, 'Alice wins!')).toBeVisible()

    await page.getByRole('button', { name: 'Play again' }).click()

    await expect(roundHeading(page, 1)).toBeVisible()
    await expect(page.getByRole('button', { name: "Enter Host's score" })).toBeVisible()
    await expect(page.getByRole('button', { name: "Enter Alice's score" })).toBeVisible()
    await expect(winnerBanner(page, 'Alice wins!')).toHaveCount(0)
  })
})
