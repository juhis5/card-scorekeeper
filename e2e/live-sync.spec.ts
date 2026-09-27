import { test, expect, type Page } from '@playwright/test'

/**
 * THE defining-requirement test (see CLAUDE.md/docs/PLAN.md and the tdd skill's "critical user
 * flows" line): a score entered on one client appears LIVE on another client, with no reload.
 *
 * Two independent `BrowserContext`s stand in for two devices (separate storage/origin state,
 * exactly like two phones at a card table) — a host and a joiner — both driven through the real
 * UI (role/label/text queries, never CSS selectors) over the real online path:
 * GameSetup/JoinGame -> useGameConnectivity -> FirestoreGameRepository -> Firestore emulator.
 *
 * Requires the Firestore + Auth emulators running (see firebase.json) and the app served with
 * `VITE_USE_EMULATOR=true` — wired by playwright.config.ts's `webServer.env`. Run via
 * `pnpm test:e2e`, which boots the emulators first (`firebase emulators:exec`) and tears them
 * down after, so every run starts from empty Firestore/Auth state. Never rely on a fixed sleep:
 * every assertion below is a Playwright web-first assertion that auto-waits/retries until the
 * Firestore `onSnapshot` update actually lands (see the tdd skill's "a flake is a bug").
 */

/** Mirrors src/lib/room-code.ts's alphabet (no 0/O/1/I) — used only to locate/parse the code
 * rendered in the UI, not to generate one. */
const ROOM_CODE_PATTERN = /[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}/

/** HomeView renders the host form (GameSetup) and the join form (JoinGame) at the same time, and
 * both have a field labelled "Your name" — scope to each form (by its card heading text) so
 * `getByLabel` never has to choose between two identically-labelled fields. */
function hostForm(page: Page) {
  return page.locator('form').filter({ hasText: 'New game' })
}

function joinForm(page: Page) {
  return page.locator('form').filter({ hasText: 'Join a game' })
}

/** Host flow: submit GameSetup with just a name. Online (emulator reachable) is the only
 * outcome under test here — the connectivity probe resolving true is asserted implicitly by the
 * caller expecting a room code to appear. */
async function startHostedGame(page: Page, hostName: string): Promise<void> {
  await page.goto('/')
  await hostForm(page).getByLabel('Your name', { exact: true }).fill(hostName)
  await hostForm(page).getByRole('button', { name: 'Start game' }).click()
}

/** Reads the room code the host's RoomView is displaying. Throws (failing the test with a clear
 * message) if the text doesn't contain a well-formed code — never silently returns garbage. */
async function readRoomCode(page: Page): Promise<string> {
  const codeText = await page.getByText(ROOM_CODE_PATTERN).innerText()
  const match = codeText.match(ROOM_CODE_PATTERN)
  if (!match) throw new Error(`expected a room code in "${codeText}"`)
  return match[0]
}

/** Joiner flow: submit JoinGame with a known room code + a name. */
async function joinHostedGame(page: Page, roomCode: string, joinerName: string): Promise<void> {
  await page.goto('/')
  await joinForm(page).getByLabel('Room code').fill(roomCode)
  await joinForm(page).getByLabel('Your name', { exact: true }).fill(joinerName)
  await joinForm(page).getByRole('button', { name: 'Join game' }).click()
}

/** Expands the player's ScoreCard (collapsed by default), then fills and commits their round-score
 * input. RoundScoreInput (src/components/RoundScoreInput.vue) commits on blur or Enter — trigger
 * blur explicitly rather than pressing Enter, which would also submit the ancestor <form>. */
async function enterRoundScore(
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

/** The scoreboard (ScoreBoard.vue) renders one real <table> with one <tr> per player, so a row
 * scoped by that player's name is a stable, ambiguity-free target for both "did they show up"
 * and "did their total update" assertions. */
function scoreboardRow(page: Page, playerName: string) {
  return page.getByRole('row', { name: new RegExp(playerName) })
}

// NOTE: this spec does not run under the `webkit` project — see playwright.config.ts's
// `webkit` project config for the documented (KNOWN ENVIRONMENT FLAKE) reason why, and the
// evidence gathered for it.
test.describe('two-client live score sync', () => {
  test('a score entered on one client appears live on the other, with no reload', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext()
    const joinerContext = await browser.newContext()

    try {
      const hostPage = await hostContext.newPage()
      const joinerPage = await joinerContext.newPage()

      const hostName = 'Host Hilla'
      const joinerName = 'Joiner Jami'

      // Host: start a game. Reaching the room heading + a room code proves the connectivity
      // probe found the emulator reachable and went ONLINE (an offline fallback never shows a
      // code — see RoomView.vue).
      await startHostedGame(hostPage, hostName)
      await expect(hostPage.getByRole('heading', { name: 'Rommi scoreboard' })).toBeVisible()
      await expect(hostPage.getByText(ROOM_CODE_PATTERN)).toBeVisible()
      const roomCode = await readRoomCode(hostPage)

      // Joiner: join that room by code, on a fully independent browser context (own storage,
      // own anonymous auth session — a second device).
      await joinHostedGame(joinerPage, roomCode, joinerName)
      await expect(joinerPage.getByRole('heading', { name: 'Rommi scoreboard' })).toBeVisible()

      // 1. The joiner appears on the HOST's scoreboard live — no reload on the host page.
      await expect(scoreboardRow(hostPage, joinerName)).toBeVisible()

      // 2. The joiner enters their own round-1 score; it appears on the HOST's scoreboard live.
      await enterRoundScore(joinerPage, joinerName, 1, 15)
      await expect(scoreboardRow(hostPage, joinerName)).toContainText('15')

      // 3. The host enters their own round-1 score; it appears on the JOINER's scoreboard live.
      await enterRoundScore(hostPage, hostName, 1, 20)
      await expect(scoreboardRow(joinerPage, hostName)).toContainText('20')
    } finally {
      await hostContext.close()
      await joinerContext.close()
    }
  })
})
