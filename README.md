# card-scorekeeper

Rommi (Finnish Rummy) live scoreboard for phones. A host starts a game, players join with a room
code, and every phone follows the scores live. With no connection, the host plays on one phone.
Production: [rommi.vercel.app](https://rommi.vercel.app). Test site:
[test-rommi.vercel.app](https://test-rommi.vercel.app).

- [`docs/PLAN.md`](docs/PLAN.md): how the app works.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): why it works that way.
- [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md): versions and pins.
- `CLAUDE.md` and `.claude/skills/`: conventions for working on the code.

## Setup

Node 24 (`nvm use` reads `.nvmrc`) and pnpm through corepack.

```sh
pnpm install
cp .env.example .env.local # fill in the VITE_FIREBASE_* web config
pnpm dev
```

To use the local emulators instead, run `pnpm exec firebase emulators:start` (needs Java) and
set `VITE_USE_EMULATOR=true` with the demo web config for project `demo-card-scorekeeper`, as in
the `webServer.env` block of `tests/e2e/playwright.config.ts`. The photo count needs
`vercel dev` and the server variables listed in `.env.example`.

## Scripts

| Command                                       | What it does                                                        |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                                    | Dev server                                                          |
| `pnpm build`                                  | Typecheck (`vue-tsc`) and production build                          |
| `pnpm preview`                                | Serve the build                                                     |
| `pnpm lint`, `pnpm format`                    | Fix lint and formatting                                             |
| `pnpm lint:check`, `pnpm format:check`        | Check only, as CI does                                              |
| `pnpm test`, `pnpm test:run`                  | Unit tests, watching or once                                        |
| `pnpm test:api`                               | The `/api/count` function, SDKs mocked                              |
| `pnpm test:api-load`                          | Compile `/api` and load it the way Vercel does                      |
| `pnpm test:rules`                             | `firebase/firestore.rules` on the emulator                          |
| `pnpm test:integration`                       | The real Firebase client SDK on the emulator                        |
| `pnpm test:e2e`                               | Playwright against the emulators (`pnpm e2e`: emulators already up) |
| `pnpm test:e2e:ci`                            | The CI run: production build, Chromium and Firefox                  |
| `pnpm test:visual`, `pnpm test:visual:update` | Compare or update screenshots in Playwright's Linux image (Docker)  |

The emulator scripts start the Firebase emulators themselves. Before the first e2e run, install
the browsers with `pnpm exec playwright install`.

## Layout

```
src/
  views/                one per route
  components/           home, room, header, menu, stats, rules, shared (ui/ is shadcn-vue)
  stores/               Pinia: game, identity, stats, highscores, result-queue, install, app-update
  composables/
  lib/game/             pure rules, scoring, stats (no Vue, no network)
  lib/data/             GameRepository: local and Firestore, stats writes, reconnect flush
  lib/platform/         browser helpers: connectivity, themes, updates, install
  locales/              fi and en strings
api/                    the photo-count function (count.ts, helpers in _lib/)
firebase/               firestore.rules and indexes
tests/rules/            rules tests on the emulator
tests/integration/      client SDK tests on the emulator
tests/e2e/              Playwright specs, visual snapshots
docs/                   PLAN, DECISIONS, TOOLCHAIN
```

Unit tests sit next to the code they test. Deploys run on Vercel: `develop` goes to the test site
on staging Firebase, `main` to production.
