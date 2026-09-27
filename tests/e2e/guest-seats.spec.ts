/**
 * Players without a phone (second playtest: names typed at the start vanished online, and the
 * host couldn't add anyone mid-game). The host starts an online game with a guest, a phone player
 * joins, the host adds another guest in round 2 and fills in the round they missed, and the game
 * finishes with every guest's stats row accepted by the rules.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  expectOnlineRoom,
  enterOwnRoundScore,
  enterRoundScore,
  addPlayerInRoom,
  startHostedGame,
  joinHostedGame,
  openFromMenu,
  readRoomCode,
  roundHeading,
  scoreboardRow,
} from './helpers'

async function fillMissedRound(page: Page, name: string, round: number, points: number) {
  await page.getByRole('button', { name: `Fill in ${name}'s missed round ${round}` }).click()
  await page.getByLabel(`${name}'s round ${round} score`).fill(String(points))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
}

/** The host scores itself and its guests, the phone player scores themselves. */
async function scoreRound(hostPage: Page, joinerPage: Page, round: number, guests: string[]) {
  await enterRoundScore(hostPage, 'Host', round, 20)
  for (const guest of guests)
    await enterRoundScore(hostPage, guest, round, GUEST_POINTS[guest] ?? 0)
  await enterOwnRoundScore(joinerPage, round, 10)
}

/** Next once everyone is in, and the phone follows; Finish after round 5. */
async function moveOn(hostPage: Page, joinerPage: Page, round: number) {
  const isLastRound = round === 5
  const button = hostPage.getByRole('button', { name: isLastRound ? 'Finish game' : 'Next round' })
  await expect(button).toBeEnabled()
  await button.click()
  if (!isLastRound) await expect(roundHeading(joinerPage, round + 1)).toBeVisible()
}

const GUEST_POINTS: Record<string, number> = { Mummo: 5, Ripa: 30 }

// Not run under the `webkit` project, like the other two-client specs: see playwright.config.ts.
test.describe('players without a phone', () => {
  test('the host scores guests added at the start and mid-game, through to the stats', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext()
    const joinerContext = await browser.newContext()
    try {
      const hostPage = await hostContext.newPage()
      const joinerPage = await joinerContext.newPage()

      await startHostedGame(hostPage, 'Host')
      await expectOnlineRoom(hostPage)
      await addPlayerInRoom(hostPage, 'Mummo')
      await expect(scoreboardRow(hostPage, 'Mummo')).toContainText('guest')

      const roomCode = await readRoomCode(hostPage)
      await joinHostedGame(joinerPage, roomCode, 'mummo')
      await expect(joinerPage.getByText(/already added a player with that name/)).toBeVisible()
      await joinHostedGame(joinerPage, roomCode, 'Alice')
      await expect(scoreboardRow(hostPage, 'Alice')).toBeVisible()

      await scoreRound(hostPage, joinerPage, 1, ['Mummo'])
      await moveOn(hostPage, joinerPage, 1)

      // Round 2: Ripa arrives without a phone, and the host fills in the round they missed.
      await addPlayerInRoom(hostPage, 'Ripa')
      await fillMissedRound(hostPage, 'Ripa', 1, 30)
      for (const round of [2, 3, 4, 5]) {
        await scoreRound(hostPage, joinerPage, round, ['Mummo', 'Ripa'])
        await moveOn(hostPage, joinerPage, round)
      }

      await expect(hostPage.getByText('Mummo wins!')).toBeVisible()
      await expect(joinerPage.getByText('Mummo wins!')).toBeVisible()
      await expect(scoreboardRow(joinerPage, 'Ripa')).toContainText('150')

      await openFromMenu(hostPage, 'Stats')
      // Head-to-head: the highscores below list players from every game.
      await expect(
        hostPage.getByRole('region', { name: 'Head-to-head' }).getByRole('row', { name: /Mummo/ }),
      ).toBeVisible()
    } finally {
      await hostContext.close()
      await joinerContext.close()
    }
  })
})
