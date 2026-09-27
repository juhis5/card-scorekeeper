/**
 * Score entry in real browsers, whose event orders happy-dom can't reproduce: a click on Cancel
 * blurs the input first, and Chromium blurs a focused input when its card collapses. A local game
 * on one device, since score entry is the same component online.
 */
import { expect, test, type Page } from '@playwright/test'
import { startLocalGame } from './helpers'

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

async function startHostAndMaiju(page: Page): Promise<void> {
  await startLocalGame(page, 'Host', ['Maiju'])
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
    await startHostAndMaiju(page)
  })

  test('the Next bar stops sticking while a field has focus, so it never covers the field', async ({
    page,
  }) => {
    const nextBar = page.locator('[data-bottom-bar]')
    await expect(nextBar).toHaveCSS('position', 'sticky')

    await typeMaijuScore(page, '10')

    await expect(nextBar).toHaveCSS('position', 'static')
  })

  test("Enter all takes the host through everyone's points, one field for all", async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Enter all' }).click()
    const sheet = page.getByRole('dialog', { name: 'Enter points · 1/2' })
    await expect(sheet.getByLabel("Host's round 1 score")).toBeFocused()

    await page.getByRole('spinbutton').fill('20')
    await page.getByRole('button', { name: 'Save and next' }).click()
    await expect(page.getByLabel("Maiju's round 1 score")).toBeFocused()
    await page.getByRole('spinbutton').fill('10')
    await page.getByRole('button', { name: 'Save and next' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Next round' })).toHaveAttribute(
      'aria-disabled',
      'false',
    )
  })

  test('tapping another card throws the open one away and opens the one tapped', async ({
    page,
  }) => {
    await page.getByRole('button', { name: "Enter Host's score" }).click()
    await page.getByLabel("Host's round 1 score").fill('20')

    await maijuCard(page).click()

    await expect(page.getByLabel("Maiju's round 1 score")).toBeVisible()
    await expect(page.getByLabel("Maiju's round 1 score")).toBeFocused()
    await expect(page.getByLabel("Host's round 1 score")).toHaveCount(0)
    await expect(page.getByRole('button', { name: "Enter Host's score" })).toBeVisible()
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

test.describe('score entry on a touch screen', () => {
  test("an opening card comes up to the top half, where the keyboard won't cover its field", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 740 },
      hasTouch: true,
    })
    try {
      const page = await context.newPage()
      await startHostAndMaiju(page)

      await maijuCard(page).tap()

      const field = page.getByLabel("Maiju's round 1 score")
      await expect(field).toBeFocused()
      const box = await field.boundingBox()
      expect((box?.y ?? 740) + (box?.height ?? 0)).toBeLessThan(740 / 2)
    } finally {
      await context.close()
    }
  })
})
