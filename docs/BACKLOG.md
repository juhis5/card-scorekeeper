# Build backlog — card-scorekeeper

Dependency-ordered **vertical** slices. Each is independently shippable + testable. Derived
from `docs/PLAN.md`; priority per `docs/BUILDER_PROMPT.md`: (1) manual scoring + live Firestore
sync, (2) offline host mode, (3) stats, (4) optional photo count. Ship 1–3 solid before 4.

Status legend: `TODO` · `WIP` · `DONE` · `BLOCKED`

---

## Slice 0 — Scaffold (Phase 0)

**Status: DONE** (`f3b61e7`) — verified: install/lint/test/build all green; `build` runs
`vue-tsc` before `vite build`; theme folded to dark-first tokens; no remote imports; hooks wired.
Vue app skeleton per CLAUDE.md scaffolding rules: create-vue (ts, pinia, router, vitest,
playwright, eslint, prettier) → Tailwind v4 → shadcn-vue init → vue-i18n (fi/en) → husky +
lint-staged + commitlint. `.env.example`. All scripts (`dev/build/preview/lint/format/test/
test:run/test:rules/e2e`) present. `pnpm build`, `pnpm test:run`, `pnpm lint` green.
**Done when:** orchestrator has verified the four commands, folded shadcn theme into
design-system dark tokens, deleted the Scaffolding section from CLAUDE.md, committed `chore: scaffold`.

## Slice 1 — Domain foundation (`lib/`) — STRICT TDD

**Status: TODO** · depends: 0
Pure domain, no Vue/network. `src/lib/types.ts` (domain types mirroring the PLAN data model:
Player, RoundScore, GameState, GameResult, contracts, card enums). `src/lib/rules.ts`:

- Card values: number = face, J/Q/K = 10, **Ace = 15, Joker = 25**.
- The **5 contracts** (round → required melds), display strings via i18n keys (not hardcoded prose).
- Round total = sum of leftover-card points; running total per player.
- Winner = **lowest total** after round 5; tie handling defined.
  Test-first, exact expected values. **Acceptance:** every card value + contract + winner/tie case
  unit-tested; `lib/` imports nothing app-specific (no Vue/Firebase/fetch).

## Slice 2 — Repository seam + local repo + game store — STRICT TDD (logic)

**Status: TODO** · depends: 1
`GameRepository` interface (per firestore-realtime skill). `LocalGameRepository` (in-memory +
localStorage, `subscribe` re-emits on mutation; no network). `identity` store (device UUID +
editable display name, persisted via pinia-plugin-persistedstate). `game`/`room` store: setup
store orchestrating rounds/scores/standings over the **interface** (not Firestore). Fresh Pinia
per test; repo mocked/local. **Acceptance:** a full 5-round game drivable in memory; standings
sort ascending; round advances 1→5; winner declared after round 5; store depends only on the
interface + `lib/`.

## Slice 3 — Core UI flow (offline-first, playable single-device)

**Status: TODO** · depends: 2
Views + components wired to the game store via `LocalGameRepository`: Home (start game / join),
Room/Scoreboard, round-score entry (`inputmode="numeric"`), contract banner ("Round 3 of 5 — …"),
standings sorted ascending (leader = lowest), automatic winner declaration after round 5.
shadcn-vue primitives; design-system dark-first tokens; **a11y-mobile** (semantic table, labelled
inputs, live-region score/round announcements, ≥44px targets, thumb-zone actions); **i18n** (no
hardcoded strings); **error-ux** states. Behavior tests for components. **Acceptance:** a full
game is playable single-device in the browser, mobile viewport, no backend.

## Slice 4 — Firestore online path + security rules + live-sync e2e

**Status: TODO** · depends: 3 · SECURITY-CRITICAL
`src/lib/firebase.ts` init (public `VITE_FIREBASE_*`). `FirestoreGameRepository` (`onSnapshot` +
writes, `writeBatch` for multi-player round; listeners unsubscribed). Room-code create/join flow;
connectivity probe on "start game" → pick Firestore vs Local repo. `firestore.rules` — **the
security boundary**: any player edits own score, host edits anyone's in their room, room-scoped
reads, writes to expired rooms rejected. Emulator rules tests (`@firebase/rules-unit-testing`):
own-vs-other edit, host override, expired room, room-scoped read. Wire `test:rules`. **One
Playwright e2e:** host + joiner in two browser contexts, a score entered on one appears on the
other. **Acceptance:** online multiplayer live sync works on the emulator; rules tests green;
e2e green; no leaked listeners.

## Slice 5 — PWA offline shell + offline UX

**Status: TODO** · depends: 4
`vite-plugin-pwa` + Workbox: manifest, icons, precache app shell so **offline cold-start loads
and a local game is playable**. Firestore `persistentLocalCache` for mid-game blips (distinct
from never-connected). error-ux: never-connected → local-game banner; blip mid-game →
reconnecting. Photo-count hidden/disabled offline; manual entry obvious. Firestore/Gemini NOT
SW-cached. **Acceptance:** with network off from cold, the shell loads and a local game runs
start→finish; the two offline modes are visually distinguished.

## Slice 6 — Persistent stats + head-to-head — STRICT TDD (derivation)

**Status: TODO** · depends: 4 (5 helps but not required)
On game finish, write `game_result` + one `game_player` per player (keyed by device UUID). Stats
derivation (pure, TDD over fixtures): wins/win-rate, best/worst final score, best/worst single
round, games played + averages, head-to-head (compare `placement` across shared `game_id`). Stats
view; identity failure-mode caveats shown where stats display. Reconnect = **push final result
only** for offline games (queue in localStorage, flush on next connected launch). Rules:
stats records append-only on finish, not editable after; emulator-tested. **Acceptance:** finishing
a game writes permanent records; stats + head-to-head compute correctly; offline result flush works.

## Slice 7 — OPTIONAL photo card-count (`/api` + frontend) — do only after 1–6 solid

**Status: TODO** · depends: 6 · OPTIONAL
Vercel `/api` serverless function holding the **Gemini key (server-only)**: room + session-token
gate (verify room via Admin SDK), per-room + global rate limits, **server-side total recompute**,
model-output validation. TDD the pure parts (gate → 403, over cap → 429, bad output rejected;
mock Gemini + Admin SDK). Frontend: camera/file composable (`capture="environment"`, desktop
file-picker fallback), confirm/edit UI (photo never silently sets a score). `vercel.json` +
env split (public vs `GEMINI_API_KEY`/`FIREBASE_SERVICE_ACCOUNT`). **Acceptance:** function
unit-tested with mocks; frontend confirm/edit flow works; manual entry still the never-fails path.

## Slice 8 — Polish, cross-platform pass, deploy docs

**Status: TODO** · depends: all above
Final `vercel.json` (SPA routing, /api runtime), README run instructions, cross-platform +
responsive review (Android Chrome / iOS Safari / desktop; 360px→wide, no overflow), reduced-motion
on score flashes / win celebration, final a11y + review-checklist pass. Feeds `docs/BUILD_REPORT.md`.

---

### Cross-cutting guards (every slice)

- Orchestrator runs `pnpm build` + `pnpm test:run` + `pnpm lint` himself — never trusts the
  agent's report. Full suite as regression guard before each commit.
- Fresh-context Sonnet review per slice (diff + intent only) against `review-checklist`.
- Emulator boots (verify before slice 4). Playwright browsers installed (before slice 4 e2e).
- No live creds — mocks/stubs + emulator only. `.env.example`, never `.env`.
- Assumptions/defaults → `docs/DECISIONS.md`. Conventional Commits. Cap 3 review rounds/slice,
  else mark BLOCKED and move on.
