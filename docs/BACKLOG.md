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

**Status: DONE** — `lib/rules.ts` + `lib/types.ts` pure & TDD'd (26 tests: card values, 54
example, all 5 contracts, tie ranking 1/1/3, contractKey↔locale linkage). Fresh review: no blocks.
Pure domain, no Vue/network. `src/lib/types.ts` (domain types mirroring the PLAN data model:
Player, RoundScore, GameState, GameResult, contracts, card enums). `src/lib/rules.ts`:

- Card values: number = face, J/Q/K = 10, **Ace = 15, Joker = 25**.
- The **5 contracts** (round → required melds), display strings via i18n keys (not hardcoded prose).
- Round total = sum of leftover-card points; running total per player.
- Winner = **lowest total** after round 5; tie handling defined.
  Test-first, exact expected values. **Acceptance:** every card value + contract + winner/tie case
  unit-tested; `lib/` imports nothing app-specific (no Vue/Firebase/fetch).

## Slice 2 — Repository seam + local repo + game store — STRICT TDD (logic)

**Status: DONE** — `GameRepository` interface + `LocalGameRepository` (shape-validated storage,
best-effort persist) + identity & game stores; store is repo-agnostic (no firebase import).
63 tests, shuffle-stable. Fresh review: no blocks; 2 should-fixes + iOS-persist nit applied.
Host seated as player 1 (invariant). Also fixed `tsconfig.vitest` DOM lib (unblocks slice 3).
`GameRepository` interface (per firestore-realtime skill). `LocalGameRepository` (in-memory +
localStorage, `subscribe` re-emits on mutation; no network). `identity` store (device UUID +
editable display name, persisted via pinia-plugin-persistedstate). `game`/`room` store: setup
store orchestrating rounds/scores/standings over the **interface** (not Firestore). Fresh Pinia
per test; repo mocked/local. **Acceptance:** a full 5-round game drivable in memory; standings
sort ascending; round advances 1→5; winner declared after round 5; store depends only on the
interface + `lib/`.

## Slice 3 — Core UI flow (offline-first, playable single-device)

**Status: DONE** — full local game playable offline (setup → 5 rounds → winner, incl. ties).
Home/GameSetup + RoomView + ScoreBoard/ContractBanner/PlayerScoreRow/RoundScoreInput/WinnerBanner,
shadcn button/input/label/table/card. 80 tests, shuffle-stable. a11y (semantic table, live regions,
44px, numeric inputmode), dark-first tokens, all-i18n. Fresh review: no blocks; 4 fixes applied
(invalid-score feedback on the golden manual path, empty-state test, aria wiring, dead key).
Not yet visually verified in a real browser — deferred to slice 8.
Views + components wired to the game store via `LocalGameRepository`: Home (start game / join),
Room/Scoreboard, round-score entry (`inputmode="numeric"`), contract banner ("Round 3 of 5 — …"),
standings sorted ascending (leader = lowest), automatic winner declaration after round 5.
shadcn-vue primitives; design-system dark-first tokens; **a11y-mobile** (semantic table, labelled
inputs, live-region score/round announcements, ≥44px targets, thumb-zone actions); **i18n** (no
hardcoded strings); **error-ux** states. Behavior tests for components. **Acceptance:** a full
game is playable single-device in the browser, mobile viewport, no backend.

## Slice 4 — Firestore online path + security rules + live-sync e2e

**Status: DONE** · depends: 3 · SECURITY-CRITICAL
Split into 4a (backend + rules, DONE) and 4b (online UI wiring + live-sync e2e, TODO).
**4a DONE:** `firebase.ts` (anon auth, `persistentLocalCache`), `FirestoreGameRepository`,
`room-code.ts`, store `join()` action, `firestore.rules` (subcollections; anon-uid identity;
member-only reads; own-score-only writes; bounded points/round + pinned doc-id; field-locked
updates), `firebase.json` (firestore+auth emulators), 24 rules tests on the emulator
(mutation-tested), `test:rules` wired. Fresh security review found + fixed 2 BLOCKs
(room-enumeration via `list`; negative-score win — ranking now derives from bounded roundScores).
Known env flake fenced off in `test:integration` (not in CI). 93 app tests green.
**4b-i DONE / 4b-ii TODO.** **4b-i DONE:** connectivity probe → online (Firestore room + shown
code) vs offline (local, unchanged); `JoinGame` join-by-code with client-side validation + friendly
error mapping (no raw errors); store `isHost`/`myPlayerId`/`isOnline`/`roundScores`; RoomView online
adaptations (self-only entry, host-only Next/Finish, offline banner, no `status==='playing'` gating);
Firebase lazy-loaded (initial chunk stays ~92kB gzip). 143 tests, shuffle-stable. Fresh review: no
blocks (2 minor fixes applied). Fixed 3 real bugs (online Next-gate, seatOrder hides late joiners,
addPlayer overwrites host doc). **4b-ii DONE:** two-client live-sync Playwright e2e
(`e2e/live-sync.spec.ts`, `pnpm test:e2e` boots firestore+auth emulators) — a score entered on one
client appears live on the other, both ways, no reload. chromium+firefox 3/3 (10/10 stress);
orchestrator-verified. Playwright-WebKit quarantined for this spec (documented flake). Follow-ups →
slice 5: real-Safari live-sync check + Firestore persistence graceful-degrade (the
`persistentMultipleTabManager` storage errors surfaced by the e2e). `test:rules` CI job → polish.
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

**Status: DONE** · depends: 4
Split: 5a (PWA shell) + 5b (offline robustness: persistence degrade, local resume, reconnecting).
**5a DONE:** `vite-plugin-pwa` (prompt-mode SW, manifest, real icons 192/512/maskable/apple-touch),
precached app shell (offline cold-start verified in-browser by killing the server — shell loads
from SW cache); Firestore/googleapis NOT SW-cached (only a nav fallback route); dismissible
"new version" update banner (a11y'd, i18n). 146 tests. **5b TODO:** (1) `firebase.ts` graceful-
degrade — a missing/invalid config or persistence failure must fall back to offline-local, NOT
throw at import and break "Start game" (found in 5a: blank `VITE_FIREBASE_*` → `getAuth` throws
synchronously); (2) `persistentMultipleTabManager` → memory/single-tab fallback for constrained
storage (iOS private mode); (3) local-game resume-on-reload; (4) mid-game "reconnecting…" indicator.
**5b DONE:** all four — firebase lazy getters + try/catch degrade to local host (proof-tested);
`canUsePersistentCache` → memory fallback + single-tab; store `resume()` route-gated to `local`
(regression-tested against online routes); `useConnectionStatus` reconnecting banner. 173 tests,
shuffle-stable (fixed a real cross-block localStorage flake at root); live-sync e2e re-verified green
after the firebase refactor. Fresh review: no blocks.
`vite-plugin-pwa` + Workbox: manifest, icons, precache app shell so **offline cold-start loads
and a local game is playable**. Firestore `persistentLocalCache` for mid-game blips (distinct
from never-connected). error-ux: never-connected → local-game banner; blip mid-game →
reconnecting. Photo-count hidden/disabled offline; manual entry obvious. Firestore/Gemini NOT
SW-cached. **Acceptance:** with network off from cold, the shell loads and a local game runs
start→finish; the two offline modes are visually distinguished.

## Slice 6 — Persistent stats + head-to-head — STRICT TDD (derivation)

**Status: DONE** · depends: 4 (5 helps but not required)
6-ui DONE: `useStatsStore` (uid-keyed, two-pass chunked query, graceful-degrade to error) +
StatsView + StatSummary/StatTile/HeadToHeadList + `/stats` route + header/Home nav + identity
caveats + i18n. 242 tests, shuffle-stable. Fresh review: no blocks (3 cosmetic nits → polish).
6-backend DONE: `lib/stats.ts` pure derivation (win-rate, best/worst final+round, averages,
head-to-head — TDD); both repos persist at finish (Firestore `game_result`/`game_player`
uid-keyed; local queues + reconnect-flush pushes host's own row); append-only rules with
auth-tied create (forgery BLOCK found+fixed by fresh review, mutation-tested); 218 tests, 46
rules tests. 6-ui TODO: stats store + Stats view + route + identity caveats display + i18n.
--- original scope ---
On game finish, write `game_result` + one `game_player` per player (keyed by device UUID). Stats
derivation (pure, TDD over fixtures): wins/win-rate, best/worst final score, best/worst single
round, games played + averages, head-to-head (compare `placement` across shared `game_id`). Stats
view; identity failure-mode caveats shown where stats display. Reconnect = **push final result
only** for offline games (queue in localStorage, flush on next connected launch). Rules:
stats records append-only on finish, not editable after; emulator-tested. **Acceptance:** finishing
a game writes permanent records; stats + head-to-head compute correctly; offline result flush works.

## Slice 7 — OPTIONAL photo card-count (`/api` + frontend) — do only after 1–6 solid

**Status: DONE** · depends: 6 · OPTIONAL
7b DONE: `useImageDownscale` (EXIF-safe, ~1600px/0.8), `usePhotoCount` (never-throws error map,
Bearer ID token), `PhotoCountSheet` (hint→capture→edit→confirm), camera/file-picker, gated
online+own-row; photo NEVER auto-commits (routes through the same validated manual `handleCommit`);
any failure → manual fallback. 286 tests. Fresh review: no blocks (4 fixes applied incl. an
invalid-confirmed-total test). Real camera/canvas/EXIF need a manual device pass (BUILD_REPORT).
--- original scope ---
7a DONE: `api/count.ts` (+ `api/_lib/*`) — Vercel Node fn; ID-token + room-membership gate;
per-room + global rate limits (injectable store, in-memory placeholder — NOT prod-scale, flagged);
server-side total recompute via direct `rules.ts` import; `@google/genai` `gemini-2.5-flash`,
temp 0, enum-constrained rank output; secrets server-only (no leak into client `dist/`, verified);
72 node-env api tests + `vercel.json` + CI `test:api`. Fresh security review: no blocks (gate
traced un-bypassable). 7b TODO: frontend — `useImageDownscale`, camera/file-picker, confirm/edit
UI (never auto-commits), online-only, i18n. Deploy-time gaps for BUILD_REPORT: KV-backed rate
limiter, live Admin/Gemini wiring unexecuted, Vercel build unverified.
--- original scope ---
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
