/**
 * Shared two-device helpers for the online e2e specs: host and join through the real UI, read the
 * room code, enter a score, play a round, and find a scoreboard row. Queries by role/label/text
 * only.
 */
import { expect, type Page } from '@playwright/test'

const TOTAL_ROUNDS = 5

/** Mirrors src/lib/room-code.ts's alphabet (no 0/O/1/I) — used only to locate/parse the code
 * rendered in the UI, not to generate one. */
export const ROOM_CODE_PATTERN = /[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}/

/** Home shows one form at a time: Join (the default) or, after switching, New game. */
export function homeForm(page: Page) {
  return page.locator('form')
}

/** Host flow: switch Home to New game and start under a name. Online (emulator reachable) is the
 * outcome under test here — the connectivity probe resolving true is asserted implicitly by the
 * caller expecting a room code to appear. */
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

/** Reads the room code the host's RoomView is displaying. Throws (failing the test with a clear
 * message) if the text doesn't contain a well-formed code — never silently returns garbage. */
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

/** Expands the player's ScoreCard (collapsed by default), fills their round-score input and taps
 * Save, the way a phone saves (its number keypad has no Enter key). */
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

/** The scoreboard (ScoreBoard.vue) renders one real <table> with one <tr> per player, so a row
 * scoped by that player's name is a stable, ambiguity-free target for both "did they show up"
 * and "did their total update" assertions. */
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

/** Both players score (the host scores 20, the joiner 10), the host moves on once both are in,
 * the board reveals the round's totals and the joiner follows. */
export async function playOnlineRound(
  hostPage: Page,
  joinerPage: Page,
  round: number,
  { hostName, joinerName }: OnlinePlayers,
): Promise<void> {
  await enterRoundScore(hostPage, hostName, round, 20)
  await enterOwnRoundScore(joinerPage, round, 10)
  const isLastRound = round === TOTAL_ROUNDS
  const button = hostPage.getByRole('button', { name: isLastRound ? 'Finish game' : 'Next round' })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(scoreboardRow(hostPage, joinerName)).toContainText(String(round * 10))
  if (!isLastRound) await expect(roundHeading(joinerPage, round + 1)).toBeVisible()
}

/** The pages live in the header's menu: open it and follow one. */
export async function openFromMenu(page: Page, pageName: string): Promise<void> {
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('dialog').getByRole('link', { name: pageName }).click()
}
