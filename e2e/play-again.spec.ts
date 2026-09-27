/**
 * Play again online (tester note 7): the host finishes, starts the next room, and the other phone
 * is asked to join it under the same name. The next game starts clean: a score the host entered
 * for a player in the finished game doesn't make that player's next round-1 score visible to the
 * host early. The local flow is in play-again-local.spec.ts.
 */
import { expect, test } from '@playwright/test'
import {
  ROOM_CODE_PATTERN,
  enterOwnRoundScore,
  enterRoundScore,
  joinHostedGame,
  playOnlineRound,
  readRoomCode,
  roundHeading,
  scoreboardRow,
  startHostedGame,
} from './helpers'

const PLAYERS = { hostName: 'Host', joinerName: 'Alice' }

// Not run under the `webkit` project, like the other two-client specs: see playwright.config.ts.
test.describe('play again', () => {
  test('the host starts the next room and the other phone joins it', async ({ browser }) => {
    const hostContext = await browser.newContext()
    const joinerContext = await browser.newContext()
    try {
      const hostPage = await hostContext.newPage()
      const joinerPage = await joinerContext.newPage()

      await startHostedGame(hostPage, 'Host')
      await expect(hostPage.getByText(ROOM_CODE_PATTERN)).toBeVisible()
      const finishedCode = await readRoomCode(hostPage)
      await joinHostedGame(joinerPage, finishedCode, 'Alice')
      await expect(scoreboardRow(hostPage, 'Alice')).toBeVisible()

      // Round 1: the host enters both scores, so this device has seen Alice's number.
      await enterRoundScore(hostPage, 'Host', 1, 20)
      await enterRoundScore(hostPage, 'Alice', 1, 10)
      await hostPage.getByRole('button', { name: 'Next round' }).click()
      await expect(roundHeading(joinerPage, 2)).toBeVisible()
      for (let round = 2; round <= 5; round++) {
        await playOnlineRound(hostPage, joinerPage, round, PLAYERS)
      }
      await expect(joinerPage.getByText('Alice wins!')).toBeVisible()

      await hostPage.getByRole('button', { name: 'Play again' }).click()
      await expect(roundHeading(hostPage, 1)).toBeVisible()
      await expect(hostPage).not.toHaveURL(new RegExp(finishedCode))
      await expect(hostPage.locator('#main-heading')).toBeFocused()
      const nextCode = await readRoomCode(hostPage)

      await expect(joinerPage.getByText('The host started a new game.')).toBeVisible()
      await joinerPage.getByRole('button', { name: 'Join the next game' }).click()
      await expect(joinerPage).toHaveURL(new RegExp(`/room/${nextCode}$`))
      await expect(joinerPage.locator('#main-heading')).toBeFocused()
      await expect(scoreboardRow(hostPage, 'Alice')).toBeVisible()

      await enterOwnRoundScore(joinerPage, 1, 5)
      await expect(scoreboardRow(hostPage, 'Alice')).toContainText('Entered')
      await expect(
        hostPage.getByRole('button', { name: "Edit Alice's score (scored)" }),
      ).toBeVisible()
    } finally {
      await hostContext.close()
      await joinerContext.close()
    }
  })
})
