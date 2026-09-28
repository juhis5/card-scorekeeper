# card-scorekeeper — Rommi (Finnish Rummy) live scoreboard

Mobile-first web app: a host creates a room code, players join, scores sync **live** via Firestore. Low total wins after a fixed 5-round contract progression. Optional photo card-count via a Gemini serverless function. Persistent per-device stats. Full spec: `docs/PLAN.md`.

## Stack

- Vite + Vue 3.5+ + TypeScript (strict) + Pinia 4 (setup stores). Composition API only.
- UI: **Tailwind v4 + shadcn-vue** (Reka UI) — copy-in accessible components you own.
- Routing: **Vue Router**. i18n: **vue-i18n** (fi/en, device-default — no hardcoded strings).
- Runtime: **Node 24** (current LTS; pinned in `.nvmrc`, matches local + CI). Not 22.
- Package manager: **pnpm**. Always install the **latest stable** versions — version numbers in docs/skills are floors, not pins. Full policy + what's pinned: `docs/TOOLCHAIN.md`.
- **Frontend hosting: Vercel** (git push → auto-deploy), same workflow as schedule-app. Gitflow: `develop` → test-rommi.vercel.app (staging Firebase), `main` → rommi.vercel.app (prod), releases fast-forward `main` (see `git-workflow`). Firestore is host-agnostic, so live sync works fine from Vercel. (All-Firebase via Firebase Hosting is the alternative if we ever want single-vendor.)
- Realtime backend: **Firebase / Firestore** (Spark free tier). Client SDK, no server for core play.
- Optional photo-count: one **Vercel serverless function** (`/api`) holding the Gemini key, gated by the caller's Firebase ID token (anonymous auth) plus a seat in a live room. Not needed for manual scoring.

## Golden rules

- **Mobile-first, one-handed at a card table.** Single column readable for 2–6 players on a phone, ≥44px tap targets, primary actions in the thumb zone. Live updates only — never a manual refresh button. Mobile-first, not mobile-only.
- **Target platforms.** Must work on **Android (Chrome), iOS (Safari), and desktop browsers** (Chromium/Firefox/Safari). Responsive ~360px→desktop (cap + center, no overflow on wide screens); camera (photo-count) falls back to a file picker on desktop; usable by touch **and** mouse/keyboard. Test on the three.
- **Firestore rules are the security boundary**, not the UI. Any player edits their own score; the host edits anyone's — enforced in `firebase/firestore.rules`.
- **Firebase web config is public** (`VITE_FIREBASE_*`) — fine. The **Gemini key is not** — it lives only in the serverless function env.
- **Fixed rules live in code**, not the DB: the 5 contracts and card values (2–9=5, 10=10, J/Q/K=10, Ace=15, Joker=25; played with 2–3 decks, so duplicate cards are normal) go in `src/lib/game/rules.ts`. Low score wins.
- **Lightweight layering, small components.** Pure domain in `lib/` (no Vue/network), I/O behind a `GameRepository` interface, Pinia orchestrates, small dumb components. Not formal Clean Architecture — keep the ceremony out. See `vue-pinia` + `clean-code`.
- Photo card-count is a **suggestion** — always confirm/edit before it commits; manual entry is the never-fails path.
- **Offline-capable host.** The host can run a full game on one device with no backend — a `LocalGameRepository` + the pure `rules.ts`. Firestore/Gemini are enhancements, not hard dependencies. Stores depend on a `GameRepository` interface so local vs online is a swap. Reconnect pushes only the final result. See `firestore-realtime`.

## Skills (in `.claude/skills/`)

- `vue-pinia` — Vue 3.5 / Pinia 4 conventions, lightweight architecture (GameRepository seam), mobile-first.
- `clean-code` — naming, function size, typing, Prettier/ESLint. Read before writing any code.
- `tdd` — pragmatic test-first (rules/stats strict, components behavior, rules on emulator, a few E2E).
- `design-system` — Tailwind v4 + shadcn theme tokens, the eight named themes (Kapteeni default), styling conventions. The visual layer.
- `component-library` — shadcn-vue (Reka UI + Tailwind v4): setup, which primitive to use, own & tweak, keep a11y.
- `routing` — Vue Router: lazy routes, named, thin guards, offline-safe nav, focus on nav.
- `i18n` — vue-i18n (fi/en): no hardcoded strings, Intl formatting, typed messages.
- `error-ux` — loading/empty/error/offline states, inline alerts + live regions, validation, confirms.
- `a11y-mobile` — semantic HTML, focus, labels, live regions (score announcements), contrast, tap targets.
- `pwa` — installable app + offline shell that makes offline host mode load (vite-plugin-pwa).
- `firestore-realtime` — live sync, room-code flow, anonymous-auth identity, security rules, offline host mode, stats.
- `vercel-gemini` — the optional room-gated photo card-count function.
- `vercel-deploy` — vercel.json, /api runtime, Firebase public/secret env split, last-mile deploy steps.
- `review-checklist` — the merge gate: skills followed, no regressions, tests sufficient, security/a11y, no hacks. Used by `/feature` + standalone.
- `git-workflow` — Conventional Commits, branch naming, git hooks (husky/lint-staged/commitlint), CI.

## Where things live

`src/` (layers split by area; see `src/CLAUDE.md`), `api/` (the photo-count function; `api/CLAUDE.md`), `tests/` (rules, integration, e2e, visual; `tests/CLAUDE.md`), `firebase/` (`firestore.rules`, `firestore.indexes.json`), `docs/` (`PLAN.md` = the app as it is, `DECISIONS.md` = why).

## Commands

- `pnpm dev` — local dev server. `pnpm build` — typecheck (`vue-tsc`) + build. `pnpm preview` — serve build.
- `pnpm lint:check` / `pnpm format:check` — the non-fixing checks CI runs. `pnpm lint` / `pnpm format` rewrite files.
- `pnpm test:run` (unit), `pnpm test:api`, `pnpm test:coverage` (both, with the coverage gates CI runs), `pnpm test:rules` + `pnpm test:integration` (start the Firebase emulator themselves), `pnpm test:e2e` / `test:e2e:ci`, `pnpm test:visual` / `test:visual:update` (Docker).
- `vercel dev` — run the app + `/api` photo-count function together locally.
- Rules + indexes deploys: `pnpm exec firebase deploy --only firestore:rules,firestore:indexes --project <id>`, always `--project` (`card-scorekeeper-staging` before merging into `develop`, `card-scorekeeper-prod-1673f` before a release; see `docs/RELEASE.md`). Never `firebase use`.
