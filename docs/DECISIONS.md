# Decisions log — autonomous build

One line per decision made without the human (asleep during the overnight build). Format:
`YYYY-MM-DD — decision — rationale`. `docs/PLAN.md` "Decisions locked" wins over anything here.

- 2026-07-23 — Backlog split into 8 vertical slices (domain → repo/store → core UI offline →
  Firestore+rules+e2e → PWA → stats → optional photo → polish). — Dependency-ordered per
  BUILDER_PROMPT (domain lib → stores/adapters → core UI → serverless/rules → offline/pwa →
  stats → polish); each slice independently shippable + testable.
- 2026-07-23 — Core UI (slice 3) built offline-first against LocalGameRepository before the
  Firestore path (slice 4). — The GameRepository seam makes online a swap, not a rewrite; a
  playable local game is the lowest-risk way to validate the domain + UI before adding network.
- 2026-07-24 — Tie handling: players with equal lowest total are co-winners, sharing placement 1
  (standard competition ranking, e.g. 1,1,3). — PLAN says "lowest total wins" but is silent on
  ties; co-winners is the least surprising rule for a friendly game and keeps placement usable
  for head-to-head stats.
- 2026-07-24 — Contract data split: `lib/rules.ts` holds the 5 contracts as structured meld
  requirements + a stable i18n key per round; human-readable descriptions live in locale files.
  — Keeps `rules.ts` free of English prose (i18n skill) while the rules themselves stay in code.
- 2026-07-24 — `GameRepository` interface (create/addPlayer/subscribe/setRoundScore/advanceRound/
  finishGame/leave) is mode-agnostic; game store injects a repo via `start(repo, config)` and
  imports no concrete repo. — The offline↔online swap is the whole point (slice 4 adds
  FirestoreGameRepository against the same interface). `setRoundScore.round` is typed
  `ContractRoundNumber`, not `number`.
- 2026-07-24 — Fixed `tsconfig.vitest.json`: removed the create-vue `lib: []` override so test
  typechecking inherits the app's `es2022+dom+dom.iterable`. — With `lib: []` (and `@types/jsdom`
  dropped for happy-dom), any DOM-touching test failed `vue-tsc` while passing at runtime;
  confirmed with a throwaway probe. Unblocks slice 3 component tests.

- 2026-07-24 — The host IS a player: `createGame` adds the host as player 1 (from
  `GameConfig.hostDisplayName`/`hostDeviceUuid`); `addPlayer` is for the other players only.
  Dropped speculative `AddPlayerInput.isHost` (host = `deviceUuid === hostDeviceUuid`). — Resolves
  the slice-2 review's "unverified seam" (unused config fields): the host plays + enters their own
  score, and "a created game contains the host as player 1" is now an invariant both repositories
  (Local now, Firestore slice 4) must uphold, pinned by a test.
- 2026-07-24 — `LocalGameRepository` persistence is best-effort: `setItem` failures (iOS Safari
  private mode quota) are caught and never break the live in-memory game or block listener
  notification. — iOS Safari is a target platform; a persistence throw must not make the offline
  host unplayable.

- 2026-07-24 — Slice 3 scoped to the playable local game flow only; the visible theme toggle and
  locale switcher UI are deferred to the polish slice (8). — Dark theme + device locale already
  default correctly from the scaffold (no-flash script + i18n detection), so a visible switcher is
  polish, not core play. Keeps slice 3 focused and reviewable. Online join + connectivity probe
  stay in slice 4 (slice 3 always starts a LOCAL game).

- 2026-07-24 — Online auth: Firebase **Anonymous Auth** is the actor identity for Firestore rules
  (`request.auth.uid`). `device_uuid` (localStorage) stays the persistent STATS key; the anon `uid`
  is the per-session AUTH key. — A `device_uuid` carried as a doc field is spoofable, so rules
  couldn't enforce "own score vs host" without a trustworthy identity; the firestore-realtime skill
  sanctions anon auth for exactly this. Player/roundScore docs carry `ownerUid`; room carries `hostUid`.
- 2026-07-24 — Firestore topology: **subcollections** under `room/{code}` —
  `room/{code}/players/{uid}`, `room/{code}/roundScores/{uid}_{round}` — NOT PLAN's flat
  top-level sketch (PLAN's data model is explicitly "(sketch)"/directional). — Makes room-scoping
  STRUCTURAL: rules match `/room/{code}/**`, ownership is `docId/ownerUid == auth.uid`, expiry is one
  `get(/room/{code})`. Firestore `playerId == auth.uid` (Local uses a random id — fine, `players[].id`
  is opaque to domain/UI).
- 2026-07-24 — Read gate (real, not weak): the `room` doc is readable by any authed user (needed for
  join-by-code discovery), but `players`/`roundScores` are readable ONLY by room members
  (`exists(/room/{code}/players/$(auth.uid))`). — PLAN says "room-scoped reads"; the subcollection
  topology lets us enforce it for real, so the rules test tests a real property instead of just
  `auth != null`.
- 2026-07-24 — Trust model for core play (CORRECTED after slice-4a adversarial review): rules
  enforce OWN-SCORE-ONLY writes (+ host may correct anyone); no server-side total recompute (no
  server; rules can't sum N docs — that review-checklist line is the slice-7 Gemini fn). The
  earlier "a player can only wreck their own total, self-defeating" reasoning was WRONG: low total
  WINS, so deflating your own score is self-SERVING. Closure: (a) rules bound `roundScores.points`
  to a non-negative integer (with a generous upper sanity cap) and `round` to 1..5; (b) the
  `roundScores` doc id is pinned to `{ownerUid}_{round}` so there's exactly one score per player
  per round (no double-count); (c) standings/winners are DERIVED from the bounded `roundScores`
  (via `runningTotal`), NOT from the freely-writable denormalized `totalScore` field — so a lied
  `totalScore` can't affect ranking. Residual (accepted, = manual scoring anywhere): a player can
  still claim they scored 0 (went out) for their own round; the table/host notices, same as lying
  aloud. The impossible-in-real-Rommi negative score is what's now blocked.
- 2026-07-24 — Room doc read is `allow get` only, NOT `allow read` (which = get + list). — Firestore
  folds `list` into `read`; granting it let any authed stranger `getDocs(collection('room'))` and
  enumerate every room, defeating join-by-code privacy. The app only ever single-doc `get`s a room
  by known code, so dropping `list` costs nothing. (Found by the slice-4a fresh security review.)

## BUILD STALL — 2026-07-24 ~00:38 Helsinki: Sonnet delegates hit the account session limit

Resets ~04:00 Helsinki. The orchestrator does not write feature code, so remaining slices wait for
the reset. HEAD = `b30ed14` (slice 4a) is clean and builds. Slice **4b-i is PARTIAL, uncommitted**
in the working tree — resume brief (do NOT restart from scratch; finish what's there):

- DONE + green (107 tests): `src/lib/connectivity.ts` (+test, the reachability probe),
  `src/lib/game-mode.ts` (+test, the Local-vs-Firestore repo factory), and the `CreatedGame`
  extension with `hostPlayerId` in `src/lib/repository.ts` + both repos (`local-repository.ts`,
  `firestore-repository.ts`) + `local-repository.test.ts`.
- ~~BROKEN: `pnpm build` fails — `src/stores/game.test.ts:46` has a fake `CreatedGame` missing the
  now-required `hostPlayerId`.~~ FIXED.
- ~~NOT DONE (finish per the online-ui delegation spec, items 4–7)~~ DONE (2026-07-24, resumed
  session): store `isHost`/`myPlayerId`/`isOnline`/`roundScores`; HomeView start-probe →
  online/offline + a `JoinGame` join-by-code entry; RoomView online adaptations (room code,
  self-only score entry, host-only Next/Finish, no gating on `status==='playing'`); i18n for all
  new strings. 141 tests green (`test:run`, and shuffled), `build`/`lint` clean. See the dated
  entries just below for the non-obvious calls made finishing this. **THEN:** slice 4b-ii
  (two-client live-sync Playwright e2e on the emulator + auth emulator) is still NOT done.

Resume order after reset: ~~finish 4b-i~~ → review → 4b-ii e2e → slice 5 (PWA) → 6 (stats) →
7 (optional photo) → 8 (polish, incl. wiring the `test:rules` CI job + BUILD_REPORT).

- 2026-07-24 — GameSetup's "other players" fields are validated (≥1 required) only once hosting
  resolves to the OFFLINE branch, never up front — online hosting proceeds with just the host,
  any typed other-player names silently unused. — Two independent reasons, not just UX taste:
  (a) docs/PLAN.md's host flow is "Reachable → normal synced room ... players join by code", i.e.
  online hosting is meant to start solo; (b) `FirestoreGameRepository.addPlayer` seats *this
  device's own* auth uid (`room/{code}/players/${uid}`) — looping it from the host's device for
  each named "other player" would silently overwrite the same doc every time, not just be
  redundant. Which branch we're on isn't known until the connectivity probe resolves, so the
  fieldset stays visible and un-blocking until then (see GameSetup.test.ts).
- 2026-07-24 — RoomView's entry-row seat order is a `ref` that only ever GROWS (append new
  playerIds as first seen via a `watch(standings, ..., {immediate:true})`), replacing the slice-3
  frozen "snapshot `standings` once at mount" list. — The frozen version broke online: `start()`
  only awaits `createGame`, not the first `onSnapshot`, so `standings` can still be empty when
  RoomView mounts; a frozen empty snapshot would permanently show zero entry rows (including the
  host's own). Growing the list also correctly picks up players who join online mid-game. Verified
  by RoomView.test.ts's existing "stable seat order" test (still passes, offline) plus new online
  tests.
- 2026-07-24 — RoomView's Next/Finish "has everyone scored this round" gate is derived from the
  store's synced `roundScores` (`roundScores.filter(round === currentRound)`), not the old
  view-local "which playerIds did I just commit through this component" `Set`. — The view-local
  version silently broke the online host: online, `entryStandings` is filtered to `myPlayerId`
  only (Firestore rules enforce own-score-only writes; see the 2026-07-24 trust-model entry), so
  the view-local set could only ever contain one id — for any room with ≥2 players,
  "all players scored" would never become true and the host's Next/Finish button would be
  permanently disabled. `roundScores` is synced state, so it reflects every player's committed
  score regardless of which device entered it — correct for both modes, and it let the view-local
  `scoredPlayerIds` ref + its round-change `watch` be deleted outright.
- 2026-07-24 — RoomView shows a persistent, icon+text (not color-only) banner keyed off
  `!isOnline`: "You're offline — playing a local game on this device." — Per the error-ux skill's
  "the offline→local path shows WHY": before this slice, local was the *only* mode, so there was
  nothing to explain; now that online hosting is attempted first, `!isOnline` reliably means "this
  device fell back to a local game" (the only remaining way to get a `null` room code), so it's a
  correct hook for the explanation without touching the actual offline scoring mechanics (host
  enters everyone, Next/Finish as before — unchanged).
- 2026-07-24 — `useGameConnectivity.ts` loads `lib/firebase.ts` + `lib/firestore-repository.ts` via
  dynamic `import()`, not a static top-level import. — `HomeView` is eager-loaded (landing route)
  and renders `GameSetup`/`JoinGame` immediately; a static import would put the whole Firebase +
  Firestore SDK in the app's initial bundle, so a fully offline host would download it before the
  home screen even paints — directly against the "offline-capable host" golden rule and
  mobile-first (a card table is exactly where connectivity is worst). Confirmed empirically: static
  import inflated the main chunk from ~90 KB to ~282 KB gzip; the dynamic import keeps the main
  chunk ~92 KB and puts Firebase in its own ~189 KB chunk fetched only when a player actually
  submits the host/join form. `lib/connectivity.ts`/`lib/game-mode.ts`/`lib/local-repository.ts`
  stay static — none of them touch Firebase.

- 2026-07-24 — Offline-host robustness (slice 5b): `firebase.ts` `db`/`auth` are LAZY getters
  (`getDb()`/`getFirebaseAuth()`), no Firebase calls at import; `useGameConnectivity` wraps the whole
  online setup (dynamic import + getters + probe + sign-in) in try/catch so ANY failure (blank/bad
  `VITE_FIREBASE_*`, import failure, sign-in reject, probe timeout) lands the HOST in a working LOCAL
  game and JOIN in a friendly "unreachable" message — never a crash. — Honors the offline-host golden
  rule: a broken/absent backend must not break local play. Accepted residual: a probe-success then
  `createGame` write failure shows a friendly retry (not a local fallback) — narrower window, still
  no raw error.
- 2026-07-24 — Firestore persistence degrades: `persistentLocalCache` + `persistentSingleTabManager`
  when storage is usable (`canUsePersistentCache` feature-detects IndexedDB + a localStorage probe),
  else `memoryLocalCache`. — Single-tab (not multi-tab) drops the cross-tab zombie-leadership work
  (multi-tab sync isn't needed one-device-per-player); memory fallback keeps iOS Safari PRIVATE mode
  working. (Firestore still logs internal "zombie client id" noise in some test browsers — cosmetic,
  non-fatal, tests pass.)
- 2026-07-24 — Local-game resume-on-reload: store `resume()` reconstructs a `LocalGameRepository`
  from localStorage and re-subscribes, GATED to the `local` room route only. — Documented exception
  to "store never touches a concrete repository" (resume is local-only by construction, no online
  counterpart). The route gate prevents resurrecting a stale local game onto a real online room URL
  (regression-tested). Reconnecting indicator uses `navigator.onLine` (same signal as the probe),
  distinct from the never-connected local banner.

## Carried-forward TODOs (flagged by implementers, not yet wired)

- ~~Slice 3: call `identityStore.ensureDeviceUuid()` at app bootstrap~~ — DONE in slice 3 (wired in
  main.ts before router, so identity is set before the first nav guard).
- ~~Slice 4: the game store's only entry is `start()`... needs a new store action `join(repo,
  code)`~~ — DONE: `useGameStore.join()` exists (seats via `addPlayer`, subscribes, never calls
  `createGame`), with `callOrder` regression coverage in game.test.ts.
- Slice 5: reload/resume of an in-progress LOCAL game. `LocalGameRepository` persists to
  localStorage, but the game store doesn't re-subscribe on mount — a hard reload mid-game loses
  the in-memory store (repo data survives, nothing reads it back). RoomView degrades gracefully
  (empty state → back home, no crash). Wire resume where offline robustness lives (slice 5).
- Slice 5 (robustness, surfaced by the 4b-ii e2e): Firestore persistence should GRACEFULLY DEGRADE.
  The live-sync e2e passes on chromium+firefox but logs `@firebase/firestore: Failed to set zombie
  client id` + `removeItem NS_ERROR_FAILURE`, and Playwright-WebKit fails the spec ~8/10 — all
  pointing at `persistentLocalCache({ tabManager: persistentMultipleTabManager() })` in
  `src/lib/firebase.ts` choking where IndexedDB/localStorage is constrained (test browsers; iOS
  Safari PRIVATE mode blocks them entirely — and iOS Safari is a target platform). Slice 5: try
  persistent cache but fall back to memory cache (or `persistentSingleTabManager`) when persistence
  is unavailable, so a constrained/private context still runs. Likely also clears the WebKit e2e flake.
- KNOWN LIMITATION (needs real-device verification, cannot do autonomously): live sync is unverified
  on REAL Safari / iOS Safari. Playwright's bundled WebKit ≠ real Safari (known networking/streaming
  divergence), so the WebKit e2e failure may be a harness artifact — but do a manual live-sync smoke
  test on a real iPhone/Safari before relying on online multiplayer there. Recorded for BUILD_REPORT.
- Slice 5: the error-ux "reconnecting…" indicator for a mid-game connectivity BLIP during an
  ONLINE game (distinct from never-connected → local). Firestore `persistentLocalCache` is already
  on (slice 4a), so a blip keeps working from cache; slice 5 adds the subtle "reconnecting…" UI +
  host-editing-others online (deferred from 4b-i) can be revisited then or in polish.
- Slice 6 (stats): local non-host players get a fresh synthetic `crypto.randomUUID()` per game
  (slice 3), so their stats won't accumulate across local games. PLAN didn't pin local-player
  identity; reconcile when building stats (device-UUID model assumes real devices).
- Slice 8 (polish): slice 3 UI is behavior-tested + static-checked (tokens/a11y/i18n) but not yet
  visually verified in a real browser at a phone viewport — do the cross-platform visual pass here.
- ~~Slice 4b: ONLINE UI must handle...~~ DONE (4b-i, 2026-07-24): RoomView filters entry rows to
  `myPlayerId` online, gates Next/Finish on `isHost`, and never gates on `status==='playing'` (the
  Next/Finish gate itself was rebuilt off synced `roundScores`, not view-local state — see the
  dated entry above). Host-editing-others' scores online is still explicitly deferred (not built).
  Still open: **4b-ii's e2e** needs BOTH firestore + auth emulators + `connectAuthEmulator`
  (`VITE_USE_EMULATOR`) — not started this session.
- CI: `.github/workflows/ci.yml` has a commented `test:rules` job — wire it now that rules exist
  (needs Java + firebase-tools on the runner). Do in 4b or polish. Do NOT add `test:integration`
  to CI (see flake below).
- KNOWN FLAKE (accepted, fenced off): `pnpm test:integration` (emulator-backed FirestoreGameRepository
  test) intermittently fails on a cold-booted emulator via Vitest — a Node24 + grpc-js + emulator
  HTTP/2 cold-boot transport race (browser uses WebChannel, so NOT a product bug). Isolated into its
  own `vitest.integration.config.ts`, OUT of `test:run`/CI/hooks. The join-order correctness it
  demonstrates is ALSO covered by a deterministic store-level `callOrder` unit test. Per tdd's flake
  rules this is the "quarantine with documented root cause" path, not a silent skip.
