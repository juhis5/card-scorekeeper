# card-scorekeeper — Rommi (Finnish Rummy) live scoreboard

Mobile-first web app: a host creates a room code, players join, scores sync **live** via Firestore. Low total wins after a fixed 5-round contract progression. Optional photo card-count via a Gemini serverless function. Persistent per-device stats. Full spec: `docs/PLAN.md`.

## Stack

- Vite + Vue 3.5+ + TypeScript (strict) + Pinia 3 (setup stores). Composition API only.
- Package manager: **pnpm**.
- Realtime backend: **Firebase / Firestore** (Spark free tier). Client SDK, no server for core play.
- Optional photo-count: one serverless function (Firebase Functions or Vercel/Netlify) holding the Gemini key, gated by room + session token. Not needed for manual scoring.

## Golden rules

- **Mobile-first, one-handed at a card table.** Single column readable for 2–6 players on a phone, ≥44px tap targets, primary actions in the thumb zone. Live updates only — never a manual refresh button.
- **Firestore rules are the security boundary**, not the UI. Any player edits their own score; the host edits anyone's — enforced in `firestore.rules`.
- **Firebase web config is public** (`VITE_FIREBASE_*`) — fine. The **Gemini key is not** — it lives only in the serverless function env.
- **Fixed rules live in code**, not the DB: the 5 contracts and card values (number=face, J/Q/K=10, Ace=15, Joker=25) go in `src/lib/rules.ts`. Low score wins.
- Photo card-count is a **suggestion** — always confirm/edit before it commits; manual entry is the never-fails path.

## Skills (in `.claude/skills/`)

- `vue-pinia` — Vue 3.5 / Pinia 3 conventions + mobile-first rules. Read before any `.vue`/store/composable.
- `firestore-realtime` — live sync, room-code flow, device-UUID identity, security rules, stats layer.
- `vercel-gemini` — the optional room-gated photo card-count function.

## Commands

- `pnpm dev` — local dev server. `pnpm build` — typecheck (`vue-tsc`) + build. `pnpm preview` — serve build.
- Firebase emulator suite for testing Firestore rules before deploy.
