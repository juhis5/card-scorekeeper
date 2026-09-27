# tests/

Unit tests live next to the code in `src/`. This folder holds the suites that need more than happy-dom.

- `rules/` — `firebase/firestore.rules` against the Firestore emulator (`pnpm test:rules`). Every rules change gets a test here first: allowed case plus each denial.
- `integration/` — the real Firebase client SDK (browser build) against the emulator (`pnpm test:integration`): flows mocks can't prove, such as join-then-subscribe or Play again carrying seats.
- `e2e/` — Playwright on a production build against the emulator (`pnpm test:e2e:ci`: Chromium + Firefox, 3 workers). Two-device specs are excluded from WebKit (see `playwright.config.ts`). Helpers in `helpers.ts` use English labels; each test creates its own rooms.
- `e2e/visual.spec.ts` — screenshots, compared only in Playwright's Linux image (`pnpm test:visual`, needs Docker). After an intended UI change: `pnpm test:visual:update` and commit the PNGs.

No retries anywhere: a flaky test is a bug to fix, never to rerun or skip.
