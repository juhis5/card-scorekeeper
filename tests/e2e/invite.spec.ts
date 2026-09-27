/**
 * Inviting: the invite sheet shows the room code and a QR code, and the link opens a page that
 * asks only for a name and seats the player in that room.
 */
import { expect, test } from '@playwright/test'
import { readRoomCode, scoreboardRow, startHostedGame } from './helpers'

test.describe('inviting players', () => {
  test('the invite link asks only for a name and seats the player in that room', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext()
    const joinerContext = await browser.newContext()
    try {
      const hostPage = await hostContext.newPage()
      const joinerPage = await joinerContext.newPage()

      await startHostedGame(hostPage, 'Host')
      const roomCode = await readRoomCode(hostPage)
      await hostPage.getByRole('button', { name: 'Invite' }).click()
      const sheet = hostPage.getByRole('dialog', { name: 'Invite players' })
      await expect(sheet.getByRole('img', { name: /QR code/ })).toBeVisible()
      await expect(sheet.getByText(roomCode, { exact: true })).toBeVisible()
      // The open sheet hides the page behind it from assistive tech, and so from these queries.
      await sheet.getByRole('button', { name: 'Close' }).click()

      await joinerPage.goto(`/join/${roomCode}`)
      await expect(
        joinerPage.getByRole('heading', { level: 1, name: `Join room ${roomCode}` }),
      ).toBeVisible()
      await expect(joinerPage.getByLabel('Room code')).toHaveCount(0)
      await joinerPage.getByLabel('Your name', { exact: true }).fill('Alice')
      await joinerPage.getByRole('button', { name: 'Join game' }).click()

      await expect(joinerPage).toHaveURL(new RegExp(`/room/${roomCode}$`))
      await expect(scoreboardRow(hostPage, 'Alice')).toBeVisible()
    } finally {
      await hostContext.close()
      await joinerContext.close()
    }
  })
})
