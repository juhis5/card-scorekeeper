/**
 * The defining requirement: a score entered on one device appears live on another, with no
 * reload. Two browser contexts stand in for two phones, over the real online path.
 */
import { test, expect } from '@playwright/test'
import {
  expectOnlineRoom,
  enterOwnRoundScore,
  enterRoundScore,
  joinHostedGame,
  readRoomCode,
  scoreboardRow,
  startHostedGame,
} from './helpers'

test.describe('two-client live score sync', () => {
  test('a score entered on one client appears live on the other, with no reload', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext()
    const joinerContext = await browser.newContext()

    try {
      const hostPage = await hostContext.newPage()
      const joinerPage = await joinerContext.newPage()

      const hostName = 'Host Hilla'
      const joinerName = 'Joiner Jami'

      // A room code means the game went online; a local fallback shows none.
      await startHostedGame(hostPage, hostName)
      await expect(hostPage.getByRole('heading', { name: 'Rommi scoreboard' })).toBeVisible()
      await expectOnlineRoom(hostPage)
      const roomCode = await readRoomCode(hostPage)

      await joinHostedGame(joinerPage, roomCode, joinerName)
      await expect(joinerPage.getByRole('heading', { name: 'Rommi scoreboard' })).toBeVisible()

      // 1. The joiner appears on the host's board.
      await expect(scoreboardRow(hostPage, joinerName)).toBeVisible()

      // 2. The host's board shows the joiner's score is in, but not the number: a round's scores
      //    are revealed when the host moves on.
      await enterOwnRoundScore(joinerPage, 1, 15)
      await expect(scoreboardRow(hostPage, joinerName)).toContainText('Entered')
      await expect(scoreboardRow(hostPage, joinerName)).not.toContainText('15')

      // 3. And the other way round.
      await enterRoundScore(hostPage, hostName, 1, 20)
      await expect(scoreboardRow(joinerPage, hostName)).toContainText('Entered')

      // 4. Next round reveals round 1 on both boards.
      await hostPage.getByRole('button', { name: 'Next round' }).click()
      await expect(scoreboardRow(hostPage, joinerName)).toContainText('15')
      await expect(scoreboardRow(joinerPage, hostName)).toContainText('20')
    } finally {
      await hostContext.close()
      await joinerContext.close()
    }
  })
})
