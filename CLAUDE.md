# card-scorekeeper — Rommi (Finnish Rummy) live scoreboard

Mobile-first web app: a host creates a room code, players join, scores sync **live** via Firestore. Low total wins after a fixed 5-round contract progression. Optional photo card-count via a Gemini serverless function. Persistent per-device stats. Full spec: `docs/PLAN.md`.

## ⚠️ Scaffolding — one-time, DELETE this section once the app skeleton exists

This repo is **not empty**. Do not clobber: `.git/ .claude/ docs/ CLAUDE.md .gitignore .prettierrc.json .prettierignore`.

- **One agent scaffolds this repo, alone.** No parallel agents here until the skeleton + first `pnpm install` exist — they race `package.json`/lockfile/config.
- `create-vue` balks on a non-empty dir → scaffold into a **temp dir and copy generated files in**, keeping the committed ones. Avoid `--force`.
- **Non-interactive:** `create-vue` prompts by default (an autonomous agent hangs). Pass flags — run `pnpm create vue@latest --help` for current names (typescript, pinia, vitest, playwright, eslint, prettier); don't hardcode from memory.
- Pin `"packageManager": "pnpm@11.17.0"` in `package.json` (pnpm is installed via corepack).
- After the skeleton: set up **Tailwind v4**, then `pnpm dlx shadcn-vue@latest init` and `add` components as needed (see `component-library`); fold its generated theme CSS into `design-system`'s dark-first values.
- Also add `vue-router` (see `routing`) + `vue-i18n` (see `i18n`), and wire git hooks: `husky` + `lint-staged` (pre-commit) + `commitlint` (commit-msg) + pre-push typecheck/test (see `git-workflow`).
- Keep the committed `.prettierrc.json` as the formatting source of truth; merge create-vue's config, don't double-add deps.
- After the first `pnpm install`, open `/hooks` once so the Prettier auto-format hook loads (this repo had no settings.json at session start).

## Stack

- Vite + Vue 3.5+ + TypeScript (strict) + Pinia 3 (setup stores). Composition API only.
- UI: **Tailwind v4 + shadcn-vue** (Reka UI) — copy-in accessible components you own.
- Routing: **Vue Router**. i18n: **vue-i18n** (fi/en, device-default — no hardcoded strings).
- Package manager: **pnpm**. Always install the **latest stable** versions — version numbers in docs/skills are floors, not pins.
- **Frontend hosting: Vercel** (git push → auto-deploy), same workflow as schedule-app. Firestore is host-agnostic, so live sync works fine from Vercel. (All-Firebase via Firebase Hosting is the alternative if we ever want single-vendor.)
- Realtime backend: **Firebase / Firestore** (Spark free tier). Client SDK, no server for core play.
- Optional photo-count: one **Vercel serverless function** (`/api`) holding the Gemini key, gated by room + session token. Not needed for manual scoring.

## Golden rules

- **Mobile-first, one-handed at a card table.** Single column readable for 2–6 players on a phone, ≥44px tap targets, primary actions in the thumb zone. Live updates only — never a manual refresh button.
- **Firestore rules are the security boundary**, not the UI. Any player edits their own score; the host edits anyone's — enforced in `firestore.rules`.
- **Firebase web config is public** (`VITE_FIREBASE_*`) — fine. The **Gemini key is not** — it lives only in the serverless function env.
- **Fixed rules live in code**, not the DB: the 5 contracts and card values (number=face, J/Q/K=10, Ace=15, Joker=25) go in `src/lib/rules.ts`. Low score wins.
- **Lightweight layering, small components.** Pure domain in `lib/` (no Vue/network), I/O behind a `GameRepository` interface, Pinia orchestrates, small dumb components. Not formal Clean Architecture — keep the ceremony out. See `vue-pinia` + `clean-code`.
- Photo card-count is a **suggestion** — always confirm/edit before it commits; manual entry is the never-fails path.
- **Offline-capable host.** The host can run a full game on one device with no backend — a `LocalGameRepository` + the pure `rules.ts`. Firestore/Gemini are enhancements, not hard dependencies. Stores depend on a `GameRepository` interface so local vs online is a swap. Reconnect pushes only the final result. See `firestore-realtime`.

## Skills (in `.claude/skills/`)

- `vue-pinia` — Vue 3.5 / Pinia 3 conventions, lightweight architecture (GameRepository seam), mobile-first.
- `clean-code` — naming, function size, typing, Prettier/ESLint. Read before writing any code.
- `tdd` — pragmatic test-first (rules/stats strict, components behavior, rules on emulator, a few E2E).
- `design-system` — Tailwind v4 + shadcn theme tokens, dark-first theming + light, styling conventions. The visual layer.
- `component-library` — shadcn-vue (Reka UI + Tailwind v4): setup, which primitive to use, own & tweak, keep a11y.
- `routing` — Vue Router: lazy routes, named, thin guards, offline-safe nav, focus on nav.
- `i18n` — vue-i18n (fi/en): no hardcoded strings, Intl formatting, typed messages.
- `error-ux` — loading/empty/error/offline states, toasts, validation, confirms.
- `a11y-mobile` — semantic HTML, focus, labels, live regions (score announcements), contrast, tap targets.
- `pwa` — installable app + offline shell that makes offline host mode load (vite-plugin-pwa).
- `firestore-realtime` — live sync, room-code flow, device-UUID identity, security rules, offline host mode, stats.
- `vercel-gemini` — the optional room-gated photo card-count function.
- `vercel-deploy` — vercel.json, /api runtime, Firebase public/secret env split, last-mile deploy steps.
- `review-checklist` — the merge gate: skills followed, no regressions, tests sufficient, security/a11y, no hacks. Used by `/feature` + standalone.
- `git-workflow` — Conventional Commits, branch naming, git hooks (husky/lint-staged/commitlint), CI.

## Commands

- `pnpm dev` — local dev server. `pnpm build` — typecheck (`vue-tsc`) + build. `pnpm preview` — serve build.
- `vercel dev` — run the app + `/api` photo-count function together locally.
- Firebase emulator suite for testing Firestore rules before deploy.
