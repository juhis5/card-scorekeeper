# Toolchain & versions

**Policy: install the latest stable version of every dependency.** Version numbers in the
skills/docs are *floors, not pins*. A few things are pinned deliberately for
reproducibility — listed below.

## Runtime — Node.js 24 (LTS)

- **Node 24** — the current Active LTS, and what we develop on (the dev machine runs
  24.16). Pinned in **`.nvmrc`** (`24`) as the single source of truth:
  - locally: `nvm use` (picks the installed 24.x).
  - CI: `actions/setup-node` with `node-version-file: .nvmrc`.
- **Why 24:** it's the Active LTS, and CI must match the runtime we build on. We don't use a
  "Current" line (26 as of September 2026): it isn't meant for production. Move to the next LTS
  on purpose, bumping `.nvmrc` and `engines` together.
- Declared in `package.json`: `"engines": { "node": "24.x" }`. Not `>=24`: Vercel picks the
  newest Node major a `>=` range allows, so the build and `/api` would move to a new major
  unnoticed while CI still tests 24.

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

- GitHub Actions: `actions/checkout`, `pnpm/action-setup`, `actions/setup-node` (and
  `actions/setup-java` for the rules job), **pinned by commit SHA** with the release tag in a
  comment. Node comes from `.nvmrc`.
- Revisit the pins when you touch CI, and at least whenever GitHub announces a runner Node
  deprecation: the v4 pins declared node20, which GitHub removed from runners on 2026-09-23.
- The `rules` and `e2e` jobs need **Java** for the Firestore emulator; firebase-tools is a
  devDependency. The `visual` job runs in Playwright's own image, tagged with the
  `@playwright/test` version.

## Pinned vs floating — summary

| Pinned (reproducibility) | Floating (latest stable) |
|---|---|
| Node major — `.nvmrc` and `engines` (`24.x`) | every other npm dependency (`^`) |
| pnpm exact — `packageManager` | (lockfile captures exact resolved versions) |
| GitHub Actions — commit SHA | |
| TypeScript `~6.0` — vue-tsc (3.3.11, Sept 2026) can't load TypeScript 7: it needs `typescript/lib/tsc`, which 7 doesn't export. Retry on each vue-tsc release | |
| `@types/node` `^24` — the Node types follow the runtime (`.nvmrc`), not the newest Node | |
| Prettier exact — a patch release can reformat the whole repo; bump it on purpose, with `pnpm format` in the same commit | |
| Playwright — the `visual` job's Docker image tag must equal `@playwright/test` | |
| `@vitest/coverage-v8` exact — must equal the installed `vitest` version; bump them together | |
