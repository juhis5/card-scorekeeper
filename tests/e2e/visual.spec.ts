/**
 * Snapshots of the key screens, in Finnish, in Kapteeni and Vihreä, dark and light. Runs only in Playwright's Linux image,
 * where the baselines are made (`pnpm test:visual`, `pnpm test:visual:update`). A local game, so
 * nothing changes between runs.
 */
import { expect, test, type Page } from '@playwright/test'
import { winnerBanner } from './helpers'

const THEMES = ['captain', 'captain-light', 'dark', 'light'] as const

test.use({ locale: 'fi-FI', viewport: { width: 390, height: 844 } })

async function openApp(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
  await page.route(/localhost:(8280|9299)/, (route) => route.abort())
  await page.goto('/')
}

async function startGameWithPlayers(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Uusi peli' }).click()
  await page.getByRole('switch', { name: 'Vain tällä laitteella' }).click()
  await page.getByLabel('Oma nimesi').fill('Juho')
  await page.getByRole('button', { name: 'Aloita peli' }).click()
  for (const name of ['Mummo', 'Jani']) {
    await page.getByRole('button', { name: 'Lisää pelaaja' }).click()
    await page.getByLabel('Pelaajan nimi').fill(name)
    await page.getByRole('button', { name: 'Lisää', exact: true }).click()
    await expect(
      page.getByRole('button', { name: new RegExp(`^Syötä pisteet: ${name}`) }),
    ).toBeVisible()
  }
}

async function enterAll(page: Page, points: number[]): Promise<void> {
  await page.getByRole('button', { name: 'Syötä kaikki' }).click()
  for (const value of points) {
    await page.getByRole('spinbutton').fill(String(value))
    await page.getByRole('button', { name: 'Tallenna ja seuraava' }).click()
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test('home', async ({ page }) => {
      await openApp(page, theme)
      await expect(page).toHaveScreenshot(`home-join-${theme}.png`)
      await page.getByRole('button', { name: 'Uusi peli' }).click()
      await expect(page).toHaveScreenshot(`home-new-${theme}.png`)
    })

    test('room, open card, points sheet, remove dialog', async ({ page }) => {
      await openApp(page, theme)
      await startGameWithPlayers(page)
      await expect(page).toHaveScreenshot(`room-${theme}.png`)

      await page.getByRole('button', { name: /^Syötä pisteet: Mummo/ }).click()
      await expect(page).toHaveScreenshot(`room-open-card-${theme}.png`)

      await page.getByRole('button', { name: 'Poista pelaaja Mummo' }).click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await expect(page).toHaveScreenshot(`room-remove-${theme}.png`)
      await page.getByRole('button', { name: 'Älä poista pelaajaa Mummo' }).click()
      await page.getByRole('button', { name: 'Peruuta' }).click()

      await page.getByRole('button', { name: 'Syötä kaikki' }).click()
      await expect(page).toHaveScreenshot(`room-enter-all-${theme}.png`)
    })

    test('a finished game', async ({ page }) => {
      await openApp(page, theme)
      await startGameWithPlayers(page)
      for (let round = 1; round <= 5; round++) {
        await enterAll(page, [round === 3 ? 0 : 20, round === 3 ? 35 : 0, 45])
        await page
          .getByRole('button', { name: round < 5 ? 'Seuraava kierros' : 'Päätä peli' })
          .click()
      }
      await expect(winnerBanner(page, /voittaa!/)).toBeVisible()
      await expect(page).toHaveScreenshot(`room-finished-${theme}.png`, { fullPage: true })
    })

    test('menu and rules', async ({ page }) => {
      await openApp(page, theme)
      await page.getByRole('button', { name: 'Valikko' }).click()
      await page.getByRole('button', { name: /^Teema/ }).click()
      // The account row appears once Firebase has loaded.
      await expect(page.getByRole('button', { name: /Kirjaudu Google-tilillä/ })).toBeVisible()
      await expect(page).toHaveScreenshot(`menu-${theme}.png`)
      await page.getByRole('link', { name: 'Säännöt' }).click()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page).toHaveScreenshot(`rules-${theme}.png`)
    })
  })
}
