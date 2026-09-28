/**
 * The header's Back control, its menu, and Home's "Continue game": moving around must never lose
 * a game in progress, and Back must never leave the app, even from a page opened directly.
 */
import { expect, test, type Page } from '@playwright/test'
import { openFromMenu, startLocalGame } from './helpers'

function homeHeading(page: Page) {
  return page.getByRole('heading', { level: 1, name: 'Rommi' })
}

function backButton(page: Page) {
  return page.getByRole('button', { name: 'Back' })
}

test.describe('Back and Continue game', () => {
  test('Home has no Back; Back returns to the previous screen', async ({ page }) => {
    await page.goto('/')
    await expect(homeHeading(page)).toBeVisible()
    await expect(backButton(page)).toHaveCount(0)

    await openFromMenu(page, 'Stats')
    await expect(page.getByRole('heading', { name: 'Your stats' })).toBeVisible()

    await backButton(page).click()
    await expect(homeHeading(page)).toBeVisible()
  })

  test('the menu opens the rules, which work without a game', async ({ page }) => {
    await page.goto('/')
    await openFromMenu(page, 'Rules')

    await expect(page.getByRole('heading', { level: 1, name: 'Rules' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'joker' })).toBeVisible()
  })

  test('the menu opens the highscores on their own page', async ({ page }) => {
    await page.goto('/')
    await openFromMenu(page, 'Highscores')

    await expect(page.getByRole('heading', { level: 1, name: 'Highscores' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Highscores' })).toBeVisible()
  })

  test('Back from a page opened directly goes Home instead of leaving the app', async ({
    page,
  }) => {
    await page.goto('/stats')
    await expect(page.getByRole('heading', { name: 'Your stats' })).toBeVisible()

    await backButton(page).click()

    await expect(homeHeading(page)).toBeVisible()
  })

  test('a local game left with Back can be continued from Home', async ({ page }) => {
    await startLocalGame(page, 'Host', ['Maiju'])

    await backButton(page).click()
    await expect(homeHeading(page)).toBeVisible()
    await page.getByRole('link', { name: 'Continue the game on this device' }).click()

    await expect(page.getByRole('heading', { name: 'Round 1 scores' })).toBeVisible()
    await expect(page.getByRole('button', { name: "Enter Maiju's score" })).toBeVisible()
  })
})
