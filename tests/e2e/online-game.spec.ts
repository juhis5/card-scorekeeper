/**
 * A whole online game on two devices: five rounds, a reload on each mid-game (both land back in
 * their seat, the host with host controls), the finish on both and the host's stats.
 */
import { expect, test } from '@playwright/test'
import {
  expectOnlineRoom,
  joinHostedGame,
  openFromMenu,
  playOnlineRound,
  readRoomCode,
  roundHeading,
  scoreboardRow,
  startHostedGame,
  winnerBanner,
} from './helpers'

const PLAYERS = { hostName: 'Host', joinerName: 'Alice' }

test.describe('a full online game', () => {
  test('plays five rounds with reloads, finishes on both devices and records stats', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext()
    const joinerContext = await browser.newContext()
    try {
      const hostPage = await hostContext.newPage()
      const joinerPage = await joinerContext.newPage()

      await startHostedGame(hostPage, 'Host')
      await expectOnlineRoom(hostPage)
      // Focus lands on the heading before the room opens, and stays there once it has.
      await expect(hostPage.locator('#main-heading')).toBeFocused()
      const roomCode = await readRoomCode(hostPage)
      await joinHostedGame(joinerPage, roomCode, 'Alice')
      await expect(scoreboardRow(hostPage, 'Alice')).toBeVisible()
      await expect(joinerPage.locator('#main-heading')).toBeFocused()

      await playOnlineRound(hostPage, joinerPage, 1, PLAYERS)
      await playOnlineRound(hostPage, joinerPage, 2, PLAYERS)

      await joinerPage.reload()
      await expect(roundHeading(joinerPage, 3)).toBeVisible()
      await playOnlineRound(hostPage, joinerPage, 3, PLAYERS)

      await hostPage.reload()
      await expect(roundHeading(hostPage, 4)).toBeVisible()
      await playOnlineRound(hostPage, joinerPage, 4, PLAYERS)
      await playOnlineRound(hostPage, joinerPage, 5, PLAYERS)

      await expect(winnerBanner(hostPage, 'Alice wins!')).toBeVisible()
      await expect(winnerBanner(joinerPage, 'Alice wins!')).toBeVisible()

      await openFromMenu(hostPage, 'Stats')
      const gamesPlayed = hostPage
        .getByText('Games played', { exact: true })
        .locator('xpath=following-sibling::dd[1]')
      await expect(gamesPlayed).toHaveText('1')
      await expect(
        hostPage.getByRole('region', { name: 'Head-to-head' }).getByRole('row', { name: /Alice/ }),
      ).toBeVisible()
    } finally {
      await hostContext.close()
      await joinerContext.close()
    }
  })
})
