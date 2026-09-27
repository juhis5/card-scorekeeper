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

/** HomeView renders the host form (GameSetup) and the join form (JoinGame) at the same time, and
 * both have a field labelled "Your name" — scope to each form (by its card heading text) so
 * `getByLabel` never has to choose between two identically-labelled fields. */
export function hostForm(page: Page) {
  return page.locator('form').filter({ hasText: 'New game' })
}

export function joinForm(page: Page) {
  return page.locator('form').filter({ hasText: 'Join a game' })
}

/** Host flow: submit GameSetup with just a name. Online (emulator reachable) is the only
 * outcome under test here — the connectivity probe resolving true is asserted implicitly by the
 * caller expecting a room code to appear. */
export async function startHostedGame(page: Page, hostName: string): Promise<void> {
  await page.goto('/')
  await hostForm(page).getByLabel('Your name', { exact: true }).fill(hostName)
  await hostForm(page).getByRole('button', { name: 'Start game' }).click()
}

/** Reads the room code the host's RoomView is displaying. Throws (failing the test with a clear
 * message) if the text doesn't contain a well-formed code — never silently returns garbage. */
export async function readRoomCode(page: Page): Promise<string> {
  const codeText = await page.getByText(ROOM_CODE_PATTERN).innerText()
  const match = codeText.match(ROOM_CODE_PATTERN)
  if (!match) throw new Error(`expected a room code in "${codeText}"`)
  return match[0]
}

/** Joiner flow: submit JoinGame with a known room code + a name. */
export async function joinHostedGame(
  page: Page,
  roomCode: string,
  joinerName: string,
): Promise<void> {
  await page.goto('/')
  await joinForm(page).getByLabel('Room code').fill(roomCode)
  await joinForm(page).getByLabel('Your name', { exact: true }).fill(joinerName)
  await joinForm(page).getByRole('button', { name: 'Join game' }).click()
}

/** Expands the player's ScoreCard (collapsed by default), then fills and commits their round-score
 * input. RoundScoreInput (src/components/RoundScoreInput.vue) commits on blur or Enter — trigger
 * blur explicitly rather than pressing Enter, which would also submit the ancestor <form>. */
export async function enterRoundScore(
  page: Page,
  playerName: string,
  round: number,
  points: number,
): Promise<void> {
  await page.getByRole('button', { name: `Enter ${playerName}'s score` }).click()
  const input = page.getByLabel(`${playerName}'s round ${round} score`)
  await input.fill(String(points))
  await input.blur()
}

/** A non-host player's own card reads "Enter your points" instead of their name. */
export async function enterOwnRoundScore(page: Page, round: number, points: number): Promise<void> {
  // exact: the missed-round cards' names also start with "Enter your points".
  await page.getByRole('button', { name: 'Enter your points', exact: true }).click()
  const input = page.getByLabel(`Your round ${round} points`)
  await input.fill(String(points))
  await input.blur()
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
