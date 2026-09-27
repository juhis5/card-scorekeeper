/**
 * Score entry on a ScoreCard, in real browsers. happy-dom can't reproduce the event orders that
 * matter here: a click on Cancel blurs the input before the click lands, and Chromium blurs a
 * focused input when collapsing the card removes it from the DOM.
 *
 * The Firestore and Auth emulators are blocked so Start falls back to a local game on this one
 * device. Score entry is the same component online, and a local game needs no second browser.
 */
import { expect, test, type Page } from '@playwright/test'

const LOCAL_GAME_KEY = 'card-scorekeeper:local-game'

/** Counts writes of the local game to localStorage, so a test can prove a score saved once. */
async function countLocalGameWrites(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    const counter = window as unknown as { localGameWrites: number }
    counter.localGameWrites = 0
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (itemKey: string, value: string) {
      if (itemKey === key) counter.localGameWrites += 1
      return setItem.call(this, itemKey, value)
    }
  }, LOCAL_GAME_KEY)
}

function localGameWrites(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { localGameWrites: number }).localGameWrites)
}

async function startLocalGame(page: Page): Promise<void> {
  await page.route(/localhost:(8280|9299)/, (route) => route.abort())
  await page.goto('/')
  const form = page.locator('form').filter({ hasText: 'New game' })
  await form.getByLabel('Your name', { exact: true }).fill('Host')
  await form.getByRole('button', { name: 'Add player' }).click()
  await form.getByLabel('Player 1 name').fill('Maiju')
  await form.getByRole('button', { name: 'Start game' }).click()
  await expect(
    page.getByText(
      "Playing a local game on this device. Others can't join, and photo count is off.",
    ),
  ).toBeVisible()
}

function maijuCard(page: Page) {
  return page.getByRole('button', { name: /^(Enter|Edit) Maiju's score/ })
}

async function typeMaijuScore(page: Page, points: string): Promise<void> {
  await maijuCard(page).click()
  await page.getByLabel("Maiju's round 1 score").fill(points)
}

test.describe('score entry on a card', () => {
  test.beforeEach(async ({ page }) => {
    await countLocalGameWrites(page)
    await startLocalGame(page)
  })

  test('tapping another card saves the open one and opens the one tapped', async ({ page }) => {
    await page.getByRole('button', { name: "Enter Host's score" }).click()
    await page.getByLabel("Host's round 1 score").fill('20')

    await maijuCard(page).click()

    await expect(page.getByLabel("Maiju's round 1 score")).toBeVisible()
    await expect(page.getByLabel("Maiju's round 1 score")).toBeFocused()
    await expect(page.getByRole('button', { name: "Edit Host's score (20 points)" })).toBeVisible()
  })

  test('Cancel discards the typed score and returns focus to the card', async ({ page }) => {
    await typeMaijuScore(page, '25')
    await page.getByRole('button', { name: 'Cancel' }).click()

    await expect(maijuCard(page)).toHaveAccessibleName("Enter Maiju's score")
    await expect(maijuCard(page)).toBeFocused()
  })

  test('Escape discards the typed score', async ({ page }) => {
    await typeMaijuScore(page, '40')
    await page.keyboard.press('Escape')

    await expect(maijuCard(page)).toHaveAccessibleName("Enter Maiju's score")
  })

  test('Enter saves the score exactly once', async ({ page }) => {
    const writesBefore = await localGameWrites(page)
    await typeMaijuScore(page, '25')
    await page.keyboard.press('Enter')

    await expect(maijuCard(page)).toHaveAccessibleName("Edit Maiju's score (25 points)")
    expect((await localGameWrites(page)) - writesBefore).toBe(1)
  })
})
