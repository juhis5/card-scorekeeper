# Toolchain & versions

**Policy: install the latest stable version of every dependency.** Version numbers in the
skills/docs are *floors, not pins*. A few things are pinned deliberately for
reproducibility — listed below.

## Runtime — Node.js 24 (LTS)

- **Node 24** — the current Active LTS, and what we develop on (the dev machine runs
  24.16). Pinned in **`.nvmrc`** (`24`) as the single source of truth:
  - locally: `nvm use` (picks the installed 24.x).
  - CI: `actions/setup-node` with `node-version-file: .nvmrc`.
- **Why 24, not 22:** 22 is the *previous* LTS. 24 is the current LTS — CI must match the
  runtime we build on. We do **not** use the odd-numbered "Current" line (25) — it isn't
  meant for production.
- After scaffold, declare it in `package.json`: `"engines": { "node": ">=24" }`.

## Package manager — pnpm (pinned exactly)

- **pnpm 11.17.0**, pinned via `"packageManager": "pnpm@11.17.0"` in `package.json`.
  This is a deliberate pin (corepack requires an exact version), **not** a floor.
  Installed via corepack — see the git-workflow / CLAUDE.md notes.

## Everything else — latest stable

Install current latest at scaffold time; the **`pnpm-lock.yaml`** then captures exact
resolved versions, giving reproducible installs without hand-pinning:

- Vite · Vue 3.5+ · TypeScript (strict) · Pinia
- Tailwind v4 · shadcn-vue (Reka UI) — added via the shadcn CLI
- Vue Router · vue-i18n
- Vitest · @vue/test-utils · Playwright · @firebase/rules-unit-testing
- Prettier (+ prettier-plugin-tailwindcss) · ESLint stack · husky · lint-staged · commitlint
- vite-plugin-pwa · firebase (client SDK) · firebase-admin (in the optional /api function)

## CI

- GitHub Actions with `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4`.
  Action **majors** are pinned (standard practice). Node comes from `.nvmrc`.
- The Firestore-rules job needs **Java + firebase-tools** for the emulator (add when rules
  land — see git-workflow / firestore-realtime).

## Pinned vs floating — summary

| Pinned (reproducibility) | Floating (latest stable) |
|---|---|
| Node major — `.nvmrc` | all npm dependencies |
| pnpm exact — `packageManager` | (lockfile captures exact resolved versions) |
| GitHub Action majors — `@v4` | |
