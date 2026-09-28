# src/

Layers, each split by area. Dependencies point inward: views → components/stores → lib.

- `lib/game/` — pure domain: `rules.ts` (the 5 contracts, card values, scoring, the one-zero rule), `types.ts`, standings, names, room codes, stats math. No Vue, no network. Strict TDD.
- `lib/data/` — I/O: the `GameRepository` interface (`repository.ts`) with `local-repository.ts` (offline, localStorage) and `firestore-repository.ts` (online), Firebase setup, stats + highscore writes, the reconnect flush.
- `lib/platform/` — browser helpers: connectivity probe, timeouts, scrolling under the keyboard, install guide, themes, update checks.
- `lib/utils.ts` — `cn()`; stays here because the shadcn CLI imports it from this path.
- `stores/` — Pinia setup stores that orchestrate: `game` (over a `GameRepository`), `identity`, `stats`, `highscores`, `result-queue` (offline games not yet uploaded), `install`, `app-update`.
- `composables/` — small reusable pieces (`useGameConnectivity` picks local vs online, `useSingleOpenCard`, `useKeepInView`, `useTheme`, …).
- `components/{home,room,header,menu,stats,rules}/` — small single-job components. `components/ui/` is owned shadcn-vue code: add with `pnpm dlx shadcn-vue@latest add <name>` and never let it overwrite `button/`.
- `views/` — one per route; thin.
- `locales/{fi,en}.json` — every user-facing string (no hardcoded text).

Tests sit next to their file (`foo.ts` + `foo.test.ts`, happy-dom). Anything touching Firebase is mocked at the module boundary; the real SDK is exercised only in `tests/integration`.
