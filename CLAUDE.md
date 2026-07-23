# card-scorekeeper — Rommi (Finnish Rummy) live scoreboard

Mobile-first web app: a host creates a room code, players join, scores sync **live** via Firestore. Low total wins after a fixed 5-round contract progression. Optional photo card-count via a Gemini serverless function. Persistent per-device stats. Full spec: `docs/PLAN.md`.

## Stack

- Vite + Vue 3.5+ + TypeScript (strict) + Pinia 3 (setup stores). Composition API only.
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

- `vue-pinia` — Vue 3.5 / Pinia 3 conventions + mobile-first rules. Read before any `.vue`/store/composable.
- `firestore-realtime` — live sync, room-code flow, device-UUID identity, security rules, stats layer.
- `vercel-gemini` — the optional room-gated photo card-count function.

## Commands

- `pnpm dev` — local dev server. `pnpm build` — typecheck (`vue-tsc`) + build. `pnpm preview` — serve build.
- `vercel dev` — run the app + `/api` photo-count function together locally.
- Firebase emulator suite for testing Firestore rules before deploy.
