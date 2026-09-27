/**
 * A whole online game across two browser contexts and the emulators: five rounds, a reload on
 * each device mid-game (both must land back in their seat, the host with host controls), the
 * finish on both devices, and the host's stats afterwards. The e2e suite otherwise stops after
 * round 1. Every assertion auto-waits for the live Firestore update, never a fixed sleep.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  ROOM_CODE_PATTERN,
  enterOwnRoundScore,
  enterRoundScore,
  joinHostedGame,
  readRoomCode,
  scoreboardRow,
  startHostedGame,
} from './helpers'

const TOTAL_ROUNDS = 5

function roundHeading(page: Page, round: number) {
  return page.getByRole('heading', { name: `Round ${round} scores` })
}

/** Both players score, the host moves on once both are in, the board reveals the round's totals
 * and the joiner follows. */
async function playRound(hostPage: Page, joinerPage: Page, round: number): Promise<void> {
  await enterRoundScore(hostPage, 'Host', round, 20)
  await enterOwnRoundScore(joinerPage, round, 10)
  const isLastRound = round === TOTAL_ROUNDS
  const button = hostPage.getByRole('button', { name: isLastRound ? 'Finish game' : 'Next round' })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(scoreboardRow(hostPage, 'Alice')).toContainText(String(round * 10))
  if (!isLastRound) await expect(roundHeading(joinerPage, round + 1)).toBeVisible()
}

// Not run under the `webkit` project, like live-sync.spec.ts: see playwright.config.ts.
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
      await expect(hostPage.getByText(ROOM_CODE_PATTERN)).toBeVisible()
      const roomCode = await readRoomCode(hostPage)
      await joinHostedGame(joinerPage, roomCode, 'Alice')
      await expect(scoreboardRow(hostPage, 'Alice')).toBeVisible()

      await playRound(hostPage, joinerPage, 1)
      await playRound(hostPage, joinerPage, 2)

      // A reload mid-game puts each device back in its seat; the host keeps host controls.
      await joinerPage.reload()
      await expect(roundHeading(joinerPage, 3)).toBeVisible()
      await playRound(hostPage, joinerPage, 3)

      await hostPage.reload()
      await expect(roundHeading(hostPage, 4)).toBeVisible()
      await playRound(hostPage, joinerPage, 4)
      await playRound(hostPage, joinerPage, 5)

      await expect(hostPage.getByText('Alice wins!')).toBeVisible()
      await expect(joinerPage.getByText('Alice wins!')).toBeVisible()

      await hostPage.getByRole('link', { name: 'Stats' }).click()
      const gamesPlayed = hostPage
        .getByText('Games played', { exact: true })
        .locator('xpath=following-sibling::dd[1]')
      await expect(gamesPlayed).toHaveText('1')
      await expect(hostPage.getByRole('row', { name: /Alice/ })).toBeVisible()
    } finally {
      await hostContext.close()
      await joinerContext.close()
    }
  })
})
