/** Ending a game early: the host ends it for everyone, nothing is recorded, the other phone is told. */
import { expect, test } from '@playwright/test'
import {
  expectOnlineRoom,
  joinHostedGame,
  readRoomCode,
  scoreboardRow,
  startHostedGame,
} from './helpers'

test.describe('ending a game early', () => {
  test('the host ends it for everyone, and the other phone says so', async ({ browser }) => {
    const hostContext = await browser.newContext()
    const joinerContext = await browser.newContext()
    try {
      const hostPage = await hostContext.newPage()
      const joinerPage = await joinerContext.newPage()
      await startHostedGame(hostPage, 'Host')
      await expectOnlineRoom(hostPage)
      await joinHostedGame(joinerPage, await readRoomCode(hostPage), 'Alice')
      await expect(scoreboardRow(hostPage, 'Alice')).toBeVisible()

      await hostPage.getByRole('button', { name: 'Menu' }).click()
      await hostPage
        .getByRole('dialog')
        .getByRole('button', { name: /^End the game/ })
        .click()
      await hostPage.getByRole('alertdialog').getByRole('button', { name: 'End the game' }).click()

      await expect(hostPage).toHaveURL(/\/$/)
      await expect(hostPage.getByRole('heading', { name: 'Game in progress' })).toHaveCount(0)
      await expect(joinerPage.getByRole('heading', { name: 'The game was ended' })).toBeVisible()
    } finally {
      await hostContext.close()
      await joinerContext.close()
    }
  })
})
