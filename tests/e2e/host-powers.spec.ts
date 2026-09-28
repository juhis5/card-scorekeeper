/**
 * Online rules for a real table: Next stays disabled until a late joiner fills in the rounds they
 * missed, so nobody is ranked on fewer rounds, and the host can score for and remove a player.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  expectOnlineRoom,
  enterOwnRoundScore,
  enterRoundScore,
  joinHostedGame,
  readRoomCode,
  scoreboardRow,
  startHostedGame,
} from './helpers'

/** A late joiner fills in their own missed round, so the card reads "Enter your points…". */
async function fillOwnMissedRound(page: Page, round: number, points: number): Promise<void> {
  await page.getByRole('button', { name: `Enter your points for missed round ${round}` }).click()
  await page.getByLabel(`Your round ${round} points`).fill(String(points))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
}

test.describe('late joiners and host powers', () => {
  test('a late joiner fills in the rounds they missed before the game moves on', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext()
    const joinerContext = await browser.newContext()
    try {
      const hostPage = await hostContext.newPage()
      const joinerPage = await joinerContext.newPage()

      await startHostedGame(hostPage, 'Host')
      await expectOnlineRoom(hostPage)
      const roomCode = await readRoomCode(hostPage)
      await enterRoundScore(hostPage, 'Host', 1, 0)
      await hostPage.getByRole('button', { name: 'Next round' }).click()
      await expect(hostPage.getByRole('heading', { name: 'Round 2 scores' })).toBeVisible()

      await joinHostedGame(joinerPage, roomCode, 'Alice')
      await expect(joinerPage.getByRole('heading', { name: 'Missed rounds' })).toBeVisible()

      await enterRoundScore(hostPage, 'Host', 2, 0)
      await enterOwnRoundScore(joinerPage, 2, 5)
      await expect(scoreboardRow(hostPage, 'Alice')).toContainText('Entered')
      await expect(hostPage.getByRole('button', { name: 'Next round' })).toBeDisabled()

      // Round 1 is already revealed, so her missed score shows at once; round 2 waits for Next.
      await fillOwnMissedRound(joinerPage, 1, 15)
      await expect(scoreboardRow(hostPage, 'Alice')).toContainText('15')
      await expect(hostPage.getByRole('button', { name: 'Next round' })).toBeEnabled()
      await hostPage.getByRole('button', { name: 'Next round' }).click()
      await expect(scoreboardRow(hostPage, 'Alice')).toContainText('20')
    } finally {
      await hostContext.close()
      await joinerContext.close()
    }
  })

  test("the host enters another player's score and can remove them", async ({ browser }) => {
    const hostContext = await browser.newContext()
    const joinerContext = await browser.newContext()
    try {
      const hostPage = await hostContext.newPage()
      const joinerPage = await joinerContext.newPage()

      await startHostedGame(hostPage, 'Host')
      await expectOnlineRoom(hostPage)
      const roomCode = await readRoomCode(hostPage)
      await joinHostedGame(joinerPage, roomCode, 'Alice')
      await expect(scoreboardRow(hostPage, 'Alice')).toBeVisible()

      // The host's entry reaches Alice's own card live; the boards only show it's in.
      await enterRoundScore(hostPage, 'Alice', 1, 25)
      await expect(
        joinerPage.getByRole('button', { name: 'Enter your points (25 points saved)' }),
      ).toBeVisible()
      await expect(scoreboardRow(joinerPage, 'Alice')).toContainText('Entered')

      await hostPage.getByRole('button', { name: /^Edit Alice's score/ }).click()
      await hostPage.getByRole('button', { name: 'Remove Alice' }).click()
      await hostPage.getByRole('button', { name: 'Yes, remove Alice' }).click()
      await expect(scoreboardRow(hostPage, 'Alice')).toHaveCount(0)
    } finally {
      await hostContext.close()
      await joinerContext.close()
    }
  })
})
