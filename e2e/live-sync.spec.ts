import { test, expect } from '@playwright/test'
import {
  ROOM_CODE_PATTERN,
  enterOwnRoundScore,
  enterRoundScore,
  joinHostedGame,
  readRoomCode,
  scoreboardRow,
  startHostedGame,
} from './helpers'

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
      await enterOwnRoundScore(joinerPage, 1, 15)
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
