/** Shared e2e helpers: host, join, score and read the board through the real UI, by role, label
 * and text. */
import { expect, type Page } from '@playwright/test'

const TOTAL_ROUNDS = 5

/** src/lib/game/room-code.ts's alphabet (no 0/O/1/I), to read the code off the page. */
export const ROOM_CODE_PATTERN = /[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}/

/** Home shows one form at a time: Join (the default) or, after switching, New game. */
export function homeForm(page: Page) {
  return page.locator('form')
}

/** Host flow: switch Home to New game and start under a name. */
export async function startHostedGame(page: Page, hostName: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'New game' }).click()
  await homeForm(page).getByLabel('Your name', { exact: true }).fill(hostName)
  await homeForm(page).getByRole('button', { name: 'Start game' }).click()
}

/** A local game on this one device: the emulators are made unreachable, so hosting falls back to
 * local, and the other players are added in the room. */
export async function startLocalGame(page: Page, hostName: string, others: string[]) {
  await page.route(/localhost:(8280|9299)/, (route) => route.abort())
  await startHostedGame(page, hostName)
  await expect(roundHeading(page, 1)).toBeVisible()
  for (const name of others) await addPlayerInRoom(page, name)
}

/** The host's "Add player" at the end of the room's cards. */
export async function addPlayerInRoom(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Add player' }).click()
  await page.getByLabel("Player's name").fill(name)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(
    page.getByRole('button', { name: new RegExp(`^Enter ${name}'s score`) }),
  ).toBeVisible()
}

function roomCodeCopyButton(page: Page) {
  return page.getByRole('button', { name: /^Copy room code / })
}

/** An online room shows its code in the header, a local game doesn't: waits for it. */
export async function expectOnlineRoom(page: Page): Promise<void> {
  await expect(roomCodeCopyButton(page)).toBeVisible()
}

/** The room code, from the header's copy button ("Copy room code 7K4RQ"). */
export async function readRoomCode(page: Page): Promise<string> {
  const copyButton = roomCodeCopyButton(page)
  await copyButton.waitFor()
  const label = (await copyButton.getAttribute('aria-label')) ?? ''
  const match = label.match(ROOM_CODE_PATTERN)
  if (!match) throw new Error(`expected a room code in "${label}"`)
  return match[0]
}

/** Joiner flow: submit JoinGame with a known room code + a name. */
export async function joinHostedGame(
  page: Page,
  roomCode: string,
  joinerName: string,
): Promise<void> {
  await page.goto('/')
  await homeForm(page).getByLabel('Room code').fill(roomCode)
  await homeForm(page).getByLabel('Your name', { exact: true }).fill(joinerName)
  await homeForm(page).getByRole('button', { name: 'Join game' }).click()
}

/** Opens the player's card, types the score and taps Save, as on a phone (its number keypad has
 * no Enter key). */
export async function enterRoundScore(
  page: Page,
  playerName: string,
  round: number,
  points: number,
): Promise<void> {
  await page.getByRole('button', { name: `Enter ${playerName}'s score` }).click()
  await page.getByLabel(`${playerName}'s round ${round} score`).fill(String(points))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
}

/** A non-host player's own card reads "Enter your points" instead of their name. */
export async function enterOwnRoundScore(page: Page, round: number, points: number): Promise<void> {
  // exact: the missed-round cards' names also start with "Enter your points".
  await page.getByRole('button', { name: 'Enter your points', exact: true }).click()
  await page.getByLabel(`Your round ${round} points`).fill(String(points))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
}

/** The scoreboard is a real <table> with a row per player, found by the player's name. */
export function scoreboardRow(page: Page, playerName: string) {
  return page.getByRole('row', { name: new RegExp(playerName) })
}

export function roundHeading(page: Page, round: number) {
  return page.getByRole('heading', { name: `Round ${round} scores` })
}

export interface OnlinePlayers {
  hostName: string
  joinerName: string
}

/** Both players score (the host 20, the joiner goes out with 0), the host moves on once both are
 * in, the board reveals the round's totals and the joiner follows. */
export async function playOnlineRound(
  hostPage: Page,
  joinerPage: Page,
  round: number,
  { hostName, joinerName }: OnlinePlayers,
): Promise<void> {
  await enterRoundScore(hostPage, hostName, round, 20)
  await enterOwnRoundScore(joinerPage, round, 0)
  const isLastRound = round === TOTAL_ROUNDS
  const button = hostPage.getByRole('button', { name: isLastRound ? 'Finish game' : 'Next round' })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(scoreboardRow(hostPage, hostName)).toContainText(String(round * 20))
  await expect(scoreboardRow(hostPage, joinerName)).not.toContainText('Entered')
  if (!isLastRound) await expect(roundHeading(joinerPage, round + 1)).toBeVisible()
}

/** The pages live in the header's menu: open it and follow one. */
export async function openFromMenu(page: Page, pageName: string): Promise<void> {
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('dialog').getByRole('link', { name: pageName }).click()
}
