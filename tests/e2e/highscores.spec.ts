/**
 * A finished online game reaches Ennätykset: the host scores the most points a round allows, so
 * their game tops the Hall of shame on a shared emulator, marked as theirs.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  enterOwnRoundScore,
  enterRoundScore,
  expectOnlineRoom,
  joinHostedGame,
  openFromMenu,
  readRoomCode,
  roundHeading,
  scoreboardRow,
  startHostedGame,
} from './helpers'

const MAX_ROUND_SCORE = 1000

/** The host takes the most points a round allows; the joiner goes out. */
async function scoreRound(hostPage: Page, joinerPage: Page, round: number): Promise<void> {
  await enterRoundScore(hostPage, 'Häviäjä', round, MAX_ROUND_SCORE)
  await enterOwnRoundScore(joinerPage, round, 0)
}

test('a finished online game shows up on Ennätykset', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const joinerContext = await browser.newContext()
  try {
    const hostPage = await hostContext.newPage()
    const joinerPage = await joinerContext.newPage()
    await startHostedGame(hostPage, 'Häviäjä')
    await expectOnlineRoom(hostPage)
    await joinHostedGame(joinerPage, await readRoomCode(hostPage), 'Voittaja')
    await expect(scoreboardRow(hostPage, 'Voittaja')).toBeVisible()

    for (const round of [1, 2, 3, 4]) {
      await scoreRound(hostPage, joinerPage, round)
      const next = hostPage.getByRole('button', { name: 'Next round' })
      await expect(next).toBeEnabled()
      await next.click()
      await expect(roundHeading(joinerPage, round + 1)).toBeVisible()
    }
    await scoreRound(hostPage, joinerPage, 5)
    const finish = hostPage.getByRole('button', { name: 'Finish game' })
    await expect(finish).toBeEnabled()
    await finish.click()
    await expect(hostPage.getByText('Voittaja wins!')).toBeVisible()

    await openFromMenu(hostPage, 'Highscores')
    await hostPage.getByRole('button', { name: 'Games' }).click()
    const hallOfShame = hostPage.getByRole('region', { name: 'Hall of shame' })
    await expect(hallOfShame.getByRole('row', { name: /Häviäjä · you .*5,000/ })).toBeVisible()
  } finally {
    await hostContext.close()
    await joinerContext.close()
  }
})
