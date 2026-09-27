/**
 * A name is unique within a room, ignoring case and extra spaces. The check has to happen on the
 * server (a joiner can't see the room's names before taking a seat), so this runs the real
 * batch, the real rules and the join form's error together.
 */
import { expect, test } from '@playwright/test'
import {
  homeForm,
  joinHostedGame,
  readRoomCode,
  expectOnlineRoom,
  scoreboardRow,
  startHostedGame,
} from './helpers'

// Not run under the `webkit` project, like the other two-client specs: see playwright.config.ts.
test.describe('unique names in a room', () => {
  test('a second "juho" is told the name is taken, and joins under another', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext()
    const joinerContext = await browser.newContext()
    try {
      const hostPage = await hostContext.newPage()
      const joinerPage = await joinerContext.newPage()

      await startHostedGame(hostPage, 'Juho')
      await expectOnlineRoom(hostPage)
      const roomCode = await readRoomCode(hostPage)

      await joinHostedGame(joinerPage, roomCode, ' juho ')
      await expect(
        joinerPage.getByText(
          'Someone in this game already uses that name. Add an initial or a nickname.',
        ),
      ).toBeVisible()

      await homeForm(joinerPage).getByLabel('Your name', { exact: true }).fill('Jani')
      await joinerPage.getByRole('button', { name: 'Join game' }).click()

      await expect(scoreboardRow(hostPage, 'Jani')).toBeVisible()
    } finally {
      await hostContext.close()
      await joinerContext.close()
    }
  })
})
