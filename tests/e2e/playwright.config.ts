import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  testDir: '.',
  outputDir: `${REPO_ROOT}/test-results`,
  // Room for two slow sync assertions in one test (see expect.timeout).
  timeout: 60 * 1000,
  expect: {
    // Raised from 5 s for cross-client sync on a loaded CI runner: a cold Firestore read has
    // taken 2.7 s, and a slow connectivity probe waits up to 8 s before a game starts.
    timeout: 30000,
  },
  forbidOnly: !!process.env.CI,
  // No retries: a retry turns a flaky test green and hides it.
  retries: 0,
  // CI's runners have 4 cores and the emulator and preview server take one. Every test makes its
  // own rooms, so tests don't share state.
  workers: process.env.CI ? 3 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: `${REPO_ROOT}/playwright-report` }]]
    : [['html', { outputFolder: `${REPO_ROOT}/playwright-report` }]],
  use: {
    actionTimeout: 0,
    // Not Vite's default ports (5173/4173): another project's dev server may already listen
    // there, and `reuseExistingServer` would then silently test that app instead of this one.
    baseURL: process.env.CI ? 'http://localhost:4183' : 'http://localhost:5183',

    // There are no retries, so keep a trace of every failure. CI uploads it with the HTML report.
    trace: 'retain-on-failure',

    headless: !!process.env.CI,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
      testIgnore: '**/visual.spec.ts',
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
      },
      testIgnore: '**/visual.spec.ts',
    },
    // Screenshots, compared only in Playwright's Linux image, where the baselines are made
    // (tests/e2e/visual.sh); anywhere else fonts render differently.
    ...(process.env.VISUAL
      ? [{ name: 'visual', use: { ...devices['Desktop Chrome'] }, testMatch: '**/visual.spec.ts' }]
      : []),
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
      },
      // Quarantined, not silently skipped: two-client Firestore sync reproducibly fails under
      // Playwright's bundled WebKit (8/10 runs, even serial with a 30 s expect timeout) while
      // Chromium and Firefox pass, so every two-client spec is ignored here. Likely the SDK's
      // transport or IndexedDB cache in Playwright's WebKit, not real Safari: check that by hand.
      testIgnore: [
        '**/visual.spec.ts',
        '**/live-sync.spec.ts',
        '**/end-game.spec.ts',
        '**/host-powers.spec.ts',
        '**/online-game.spec.ts',
        '**/unique-names.spec.ts',
        '**/play-again.spec.ts',
        '**/guest-seats.spec.ts',
        '**/invite.spec.ts',
      ],
    },
  ],

  webServer: {
    // The dev server locally. On CI, the production build (service worker included), built in
    // this command because Vite bakes VITE_* values in at build time and `env` applies only here.
    // `vite` is called directly: `pnpm run dev -- --port 5183` passes the `--` on, and vite then
    // ignores `--port`.
    command: process.env.CI
      ? 'pnpm exec vite build && pnpm exec vite preview --port 4183'
      : 'pnpm exec vite --port 5183',
    port: process.env.CI ? 4183 : 5183,
    cwd: REPO_ROOT,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // room for the CI build before the preview server starts
    // Points the app at the local emulators, with a fake web config for `.firebaserc`'s demo
    // project. Real env vars beat any `.env` file, so a developer's own config never applies.
    env: {
      VITE_USE_EMULATOR: 'true',
      VITE_FIREBASE_API_KEY: 'demo-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'demo-card-scorekeeper.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'demo-card-scorekeeper',
      VITE_FIREBASE_STORAGE_BUCKET: 'demo-card-scorekeeper.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
      VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000000000',
    },
  },
})
