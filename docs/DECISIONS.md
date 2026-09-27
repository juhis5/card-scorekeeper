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

- 2026-07-24 — Stats identity keying (slice 6): stats are keyed by device UUID. They AGGREGATE
  across games for real devices — the host (their own persisted `device_uuid`) and online joiners
  (each their own device). In a LOCAL game the host's other players are ad-hoc names on one device
  with per-game synthetic UUIDs (slice 3), so they appear in THAT game's result + head-to-head but
  do NOT aggregate across games. — This is the documented "history follows the device, not the
  person" limitation (PLAN "Stats & history"), not a bug; the highest-value stat (the host's own
  record) works everywhere, online opponents aggregate correctly, and we avoid inventing a
  cross-game identity for ad-hoc local players that PLAN never specified. Surface the caveat in the
  Stats UI.

- 2026-07-24 — Slice 6 (stats backend) built: `lib/stats.ts` (pure `playerStats`/`headToHead`/
  `bestAndWorstRound`, no `GameResult[]` needed — every stat PLAN asks for lives on `GamePlayer`
  rows, grouped by their own `gameId`), persistence in both repositories' `finishGame`
  (`LocalGameRepository` queues `{result, players}` to a localStorage `pending-results` list via
  new `lib/pending-results.ts`; `FirestoreGameRepository` writes straight to top-level
  `game_result/{gameId}` + `game_player/{gameId}_{deviceUuid}` via new `lib/firestore-stats.ts`),
  a reconnect flush (`pending-results.ts`'s `flushPendingResults`, wired minimally at launch via
  `lib/reconnect-flush.ts` + `main.ts`), and `firestore.rules` append-only records for both
  collections. `lib/key-value-storage.ts` extracted from `local-repository.ts` (2nd real
  duplication) so `pending-results.ts` can share the `KeyValueStorage` interface without a
  circular import.
- 2026-07-24 — `game_result`/`game_player` create-authorization is a HYBRID, not a flat "any
  authed user": when a gameId corresponds to an existing `room/{code}` doc (an online game — the
  common case, since `FirestoreGameRepository` uses the room code as the gameId), only that
  room's host may create its stats rows (`roomExists(gameId) → isHost(gameId)`), matching "the
  host is the one finishing, so it writes all rows". When no room exists for that gameId (a
  purely local/offline game only reaching Firestore via the reconnect flush — there is no room
  doc to check a participant against for a game that was never online), the floor is bare
  authed-create + well-formed fields + referential integrity (`game_player` requires a matching
  `game_result` to already exist, via `exists()` — not batched with it, since a `get()` inside a
  rule can't see a sibling write from the same batch, so the two are genuine sequential writes,
  same pattern as `createGame`'s room-then-player order). Both are read-open to any authed user
  (shared game outcomes among friends, not sensitive per PLAN) and always deny `update`/`delete`.
- 2026-07-24 — `writeGameResult` (`lib/firestore-stats.ts`) is per-document IDEMPOTENT
  (`getDoc` existence check before every `setDoc`, skipping docs already written) — found in
  review, not in the original design. The reconnect flush retries a whole queued result on the
  NEXT launch after ANY failure, including a partial one: `Promise.all` over `game_player` writes
  rejects on the first failure, but sibling writes that already resolved are already committed.
  Without the idempotency check, retrying would re-`setDoc` an already-written append-only doc,
  which the rules' `update` denial would reject forever — turning one transient failure into a
  permanent block on that game (and, since the flush stops at the first failure, on every later
  queued game too). The extra reads are cheap for this low-frequency, tiny-record feature.

- 2026-07-24 — Stats rows key on the anon UID, NOT the separate localStorage `device_uuid`, and
  writes are tied to auth in rules (closes a targeted-forgery BLOCK from the 6-backend review).
  `game_player.deviceUuid` = the player's uid (= their `room/{code}/players/{uid}` id). Create rule:
  ONLINE (room exists) → only the host may write, and only for a real participant
  (`exists(players/{uid})`); LOCAL (flushed offline game) → `deviceUuid == request.auth.uid`
  (self-write only), and only the HOST's own row is flushed (local ad-hoc co-players don't
  aggregate). — Without tying the written deviceUuid to `request.auth.uid`, any authed stranger
  could forge a permanent append-only win/loss on any victim's stats. The room already keys players
  by uid, so this is a bounded slice-6 change (no identity rewrite, no finish-flow rewrite).
  Mutation-tested: the forgery negatives fail against the pre-fix rule.
- 2026-07-24 — Stats reads (`game_result`/`game_player`) stay OPEN to any authed user (not
  per-device-scoped). — Head-to-head must read opponents' rows, so per-device read scoping would
  break it; now that forgery is closed by the create rules, open reads are just "friends see the
  group's shared game history" (intended). Numeric bounds pinned by rules tests (finalScore ≤5000,
  placement 1..50, best/worst round ≤1000, totalRounds == 5).
- 2026-07-24 — ACCEPTED RESIDUAL (within PLAN's "stats are only as trustworthy as the identity
  model"): a malicious HOST can still misreport the result of a game played IN THEIR OWN room —
  rules can't recompute a total from N per-round docs (no server). This is the same trust line
  already accepted for live play; correcting it would need a server. Not a blocker.

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
- ~~Slice 6 (stats): local non-host players get a fresh synthetic `crypto.randomUUID()` per
  game...~~ RECONCILED (2026-07-24, see the "Stats identity keying" entry above): `lib/stats.ts`
  doesn't special-case it — a synthetic per-game UUID just never repeats across games, so it
  naturally never aggregates, which is the documented behavior, not a bug to fix here.
- Slice 6 (stats) — left for the Stats UI/store slice, NOT built here per this slice's scope
  (backend only): the actual views/routes/store reading `game_result`/`game_player` back out and
  rendering `playerStats`/`headToHead`, and surfacing the identity caveats (device-follows-not-
  person, local non-aggregation) in that UI per PLAN.
- Slice 6 (stats) — residual gap, accepted for this slice: an ONLINE game's `finishGame` writes
  `game_result`/`game_player` directly (no queue) after the room already flipped to `'finished'`;
  if that specific write fails (as opposed to the room update, which is a separate, already-
  awaited call), there's no retry — unlike the offline path, which always has the
  `pending-results` queue as a safety net. Not treated as a blocker (the game itself still ends
  correctly for players either way), but worth a queue-on-failure fallback if it's ever observed
  in practice.
- Slice 6 (stats): the new `finishGame`-writes-`game_result`/`game_player` end-to-end assertion
  lives in `tests/integration/firestore-repository.test.ts` — the quarantined, NOT-in-CI,
  documented-flake suite (see the KNOWN FLAKE entry below), not `pnpm test:rules`/`test:run`. It
  passed every run this session; treat it as bonus real-emulator evidence, not a CI gate.
- Slice 8 (polish): slice 3 UI is behavior-tested + static-checked (tokens/a11y/i18n) but not yet
  visually verified in a real browser at a phone viewport — do the cross-platform visual pass here.
- ~~Slice 4b: ONLINE UI must handle...~~ DONE (4b-i, 2026-07-24): RoomView filters entry rows to
  `myPlayerId` online, gates Next/Finish on `isHost`, and never gates on `status==='playing'` (the
  Next/Finish gate itself was rebuilt off synced `roundScores`, not view-local state — see the
  dated entry above). Host-editing-others' scores online is still explicitly deferred (not built).
  Still open: **4b-ii's e2e** needs BOTH firestore + auth emulators + `connectAuthEmulator`
  (`VITE_USE_EMULATOR`) — not started this session.
- CI: `.github/workflows/ci.yml` has a commented `test:rules` job — wire it now that rules exist
  (needs Java + firebase-tools on the runner). Do in 4b or polish. ~~Do NOT add `test:integration`
  to CI (see flake below).~~ Added 2026-09-27 once the flake was fixed.
- ~~KNOWN FLAKE~~ FIXED 2026-09-27 (see the dated entry at the end). Original note: `pnpm test:integration` (emulator-backed FirestoreGameRepository
  test) intermittently fails on a cold-booted emulator via Vitest — a Node24 + grpc-js + emulator
  HTTP/2 cold-boot transport race (browser uses WebChannel, so NOT a product bug). Isolated into its
  own `vitest.integration.config.ts`, OUT of `test:run`/CI/hooks. The join-order correctness it
  demonstrates is ALSO covered by a deterministic store-level `callOrder` unit test. Per tdd's flake
  rules this is the "quarantine with documented root cause" path, not a silent skip.

## Polish-slice nits (swept in slice 8)

- `src/stores/stats.ts` — replace the ad-hoc `as { finishedAt: string }` cast with `as GameResult`
  (the domain type already has the field) for clean-code consistency. (Nit, 6-ui review.)

- 2026-07-24 — Photo-count gate (slice 7) uses the caller's FIREBASE ID TOKEN (verified by the
  Admin SDK) + room membership, NOT the skill's self-asserted `sessionToken` field. — Consistent
  with the anon-auth decision and not forgeable (same lesson as the stats-forgery fix): the client
  sends its Firebase ID token, the function verifies it → uid → checks the room exists/active/
  not-expired AND `players/{uid}` exists in it. A self-asserted token field would be spoofable.

- 2026-07-24 — Slice 8 polish: theme toggle + locale switcher shipped (the slice-3 deferral).
  `useTheme` is a non-singleton composable persisting `localStorage['theme']` byte-for-byte like
  index.html's no-flash script (NOT via pinia-persistedstate, which JSON-wraps and would break the
  match + reintroduce flash). Reduced-motion audit: only real motion was the shadcn Sheet
  enter/exit — gated via an UNLAYERED `@media (prefers-reduced-motion: reduce)` in main.css
  (Tailwind v4 `motion-reduce:` utilities lost to source-order within `@layer utilities`; unlayered
  rules beat all layered ones — verified against compiled CSS). No score/win-celebration motion exists.
- 2026-07-24 — Two cosmetic follow-ups (non-blocking, for BUILD_REPORT): index.html's
  `<meta name="theme-color">` stays dark-tinted in light mode (a clean fix needs reading
  `--background` at runtime, not a second hardcoded hex); shadcn `SheetContent`'s built-in "Close"
  label is hardcoded English but unreachable today (`PhotoCountSheet` sets `:show-close-button="false"`).
- 2026-09-27 — Card values changed to the house rule: **2–9 = 5, 10 = 10**, J/Q/K = 10, Ace = 15,
  Joker = 25 (was number = face value). Every value is now a multiple of 5, so a round score must be
  too — `isValidRoundScore` in `rules.ts` rejects anything else, and `firestore.rules` mirrors it
  with `points % 5 == 0` on `roundScores` only. `gamePlayers` bounds are deliberately NOT tightened:
  an offline host's pending result recorded under the old values would otherwise be rejected on
  reconnect forever.
- 2026-09-27 — The game is played with **2 decks (sometimes 3)**. Scoring is per physical card, so
  deck count changes nothing in `rules.ts`; the one single-deck assumption was the Gemini prompt
  ("count each card once" invites merging two identical 7♥), now told to list every copy. No
  deck-count game setting: its only use would be capping copies per card when validating a photo
  read, which isn't worth a new field through types, both repositories, rules and UI.
- 2026-09-27 — `test:integration` flake FIXED and the suite is back in CI (the `rules` job). Root
  cause was not a warm-up race: the Node SDK's gRPC `Listen` stream loses its framing against the
  emulator (reads protobuf bytes as a length prefix — `Received message larger than max
  (1919182194 vs 4194304)` = ASCII "rder"), backs off ~60s, and the 30s test times out. Open
  upstream: firebase/firebase-tools#8654. Failed ~1 in 3 cold runs, on `main` too. Fix: the suite
  runs the SDK's browser build (WebChannel — what the app ships) via happy-dom + inlined `firebase`
  + an alias to the browser entry (see vitest.integration.config.ts); the `warmUpListenChannel`
  workaround is gone. 20/20 cold runs green, ~2s each (was ~15–30s).
- 2026-09-27 — Correction to the entry above: "20/20 cold runs green" was partly judged on the
  "Tests passed" line, not the exit code. A second, exit-code-only flake remained (3 in 35 runs
  during the full review): on `deleteApp` the SDK sends WebChannel's `TYPE=terminate` request via
  `navigator.sendBeacon` without awaiting it, happy-dom implements the beacon as a `fetch()` whose
  promise nobody handles, and when Vitest aborts the window at teardown that rejection is unhandled,
  so the run exits 1 with every assertion passing. Re-calling `terminate()` wouldn't help:
  `deleteApp` already runs it. Fix: `tests/integration/beacon.setup.ts` makes the beacon send and
  drop its outcome, as a browser does. Verified all 8 terminate beacons per run go through it, then
  40/40 cold runs exited 0. Flake checks on emulator suites now count exit codes (tdd skill).
- 2026-09-27 — CI made real (review round 1): node24 Actions pinned by commit SHA, a read-only
  `GITHUB_TOKEN`, `workflow_dispatch`, and non-fixing `lint:check` / `format:check` gates. The v4
  pins declared node20, which GitHub removed from runners on 2026-09-23; CI had not run since
  2026-07-24.
- 2026-09-27 — e2e added to CI as its own `e2e` job (`pnpm test:e2e:ci`): Chromium + Firefox against
  the emulators and a production build. Playwright's CI server command now runs `vite build` before
  `vite preview`, because Vite bakes `VITE_*` values in at build time and the emulator config is only
  passed to that command. Retries dropped from 2 to 0 so a flake fails the job instead of hiding;
  traces are kept on failure and the HTML report is uploaded as an artifact. WebKit stays excluded
  from live sync (the documented flake). Make `e2e` a required check once it has passed a few runs.
- 2026-09-27 — Review round 2, "scores always land":
  - One round-score cap on both sides: `MAX_ROUND_SCORE` (1000) in `rules.ts`, `<= 1000` in
    `firestore.rules`, parity pinned by rules tests that import the constant. `-0` is rejected.
  - The reconnect flush moves permanently rejected results (`isPermanentWriteError`) to
    `card-scorekeeper:pending-results-failed` and keeps going; transient errors still stop it. The
    failed list is kept, not shown in the UI yet. Each success removes its own entry from a fresh
    read, so a game queued mid-flush survives.
  - ScoreCard: a blur saves only while the card is open and focus leaves the card; a press inside
    the card counts as staying (iOS doesn't focus tapped buttons). Cancel/Escape restore the last
    saved value. `e2e/score-entry.spec.ts` pins this in real browsers.
  - RoomView shows an inline alert when a score, Next or Finish save fails, and says the room is
    closed on permission-denied. Listener (onSnapshot) errors are still silent; that's round 3.
  - Light `--primary`/`--ring` moved to #047857 and focus rings to 80% opacity for WCAG AA;
    `src/assets/theme-contrast.test.ts` enforces the token pairs.
- 2026-09-27 — Review round 3a, owner decisions:
  - **Late joiners fill in the rounds they missed** (owner's rule, instead of closing joins or a
    penalty). `missingRounds`/`isEveryRoundScored` in `rules.ts`; Next/Finish check every round
    so far, so nobody is ranked on fewer rounds. Joining stays open for the room's life.
  - **Host powers, online too:** the host enters or fixes anyone's score (this supersedes the
    "host-editing-others online is deferred" notes above) and can remove another player's seat
    with its scores. Rules: players/roundScores `delete` for the host only, never their own seat,
    only while the room is live. A removed player can rejoin by code (accepted for now).
  - **Seat validation in rules:** exact keys, name 1–40 chars (`MAX_PLAYER_NAME_LENGTH`), starting
    total 0, integer `joinOrder`; updates keep name valid and total a non-negative int.
  - Players without a phone in online rooms: deferred to its own round.
- 2026-09-27 — Review round 3b, connection resilience:
  - Reachability = sign in + `getDocFromServer('room/probe')`. Sign-in alone is answered from cache
    for a returning device, so Wi-Fi without internet used to pass and Start then hung. (Not
    `__probe__`: Firestore rejects ids matching `__.*__`, caught by the online e2e.)
  - Creating a room / taking a seat time out after 10 s (`withTimeout`, a transient
    `deadline-exceeded`); the host falls back to a local game, a joiner is told the game is
    unreachable. The queued write may still land later as an orphan room; accepted.
  - Reload resumes `/room/CODE`: `findSeat()` (seat read refused by the rules = not seated; host
    from `hostUid`), idempotent `addPlayer`, and "Opening room" / "Join room CODE" states.
  - `subscribe(onChange, onError)`: listener failures show "no longer in this room"
    (permission-denied, e.g. removed or closed) or "connection lost, reload".
  - The launch flush no longer loads Firebase when nothing is queued. The offline banner says
    "Playing a local game on this device…" instead of claiming "You're offline".
  - Still open: a snapshot-metadata "not synced yet" indicator (sync-7) and showing the
    failed-results list.
- 2026-09-27 — Review round 4, stats you can trust:
  - Every `game_result`/`game_player` doc carries `participantUids` (the players' auth uids, from
    the rows' `deviceUuid`). Only participants can get or list; the stats store filters
    `array-contains uid` on every query. This replaces the "reads open to any authed user"
    decision: that audience was anyone with the public config, not friends.
  - Namespaces: room ids must be room codes, local game ids must be UUIDs, so neither can squat
    the other's stats. A local result's participants must be exactly its writer, and only a
    participant can add a row, which closes the head-to-head injection.
  - Rooms: exact fields and a ≤7 h expiry on create; updates advance one round at a time, finish
    only in round 5, never reopen. Round scores: seated writer, running game, started round; a
    player may create a missed round but only the host updates an earlier one.
  - `GameResult.winnerUuid` dropped (never read, wrong identity namespace); placement rules.
  - Security headers in `vercel.json`; the CSP is Report-Only until a preview deploy is checked.
  - Deferred to deploy time: App Check, and a room TTL. Online stats are keyed by room code, which
    is safe only while rooms are never deleted; a TTL would need a per-game id first.
- 2026-09-27 — Review round 5, photo count deployable:
  - **Photo count ships on, with per-instance rate limits** (owner's call). The per-room and
    global caps live in memory, so each Vercel instance and cold start gets a fresh budget; the
    real ceiling is the no-billing Gemini key's free-tier quota. Accepted risk: a seated player can
    use up the day's quota for everyone, and photo count then answers "busy" until it resets.
    Upgrade path: an Upstash/Redis `RateLimitStore`.
  - **Model from `GEMINI_MODEL`**, default `gemini-3.8-flash` (Google's current Flash for new
    projects; 2.5 Flash is limited to existing users). Thinking level low, capped output, 15 s
    abort, `maxDuration: 30`; temperature left at the Gemini 3 default.
  - `api/` runs as native ESM on Vercel, so relative imports carry `.js` (also in the `src/lib`
    files it imports). `tsconfig.api.json` checks it and `pnpm test:api-load` loads the compiled
    function in CI; before this the deployed function would have failed to load.
  - Requests are checked before any I/O (room-code format, image type, base64, size). Only
    `auth/*` token errors are a 401; other Admin SDK failures are logged 500s. Gemini failures
    map to 504 (timeout), 503 (quota) or 502, and more than 60 detected cards is a 422.
  - The sheet gives each failure its own message and offers "Try again" only when a retry can
    work. The total is its own draft and must be a valid round score before it can be used.
    Card inputs are named "Card 2 of 4: 7 of hearts" (fi: "Kortti 2/4: hertta 7"), so copies
    from a second deck stay distinct. The picker no longer forces the camera.
  - The Gemini key belongs in a separate Google Cloud project, restricted to the Generative
    Language API; never the Firebase browser key.
- 2026-09-27 — Deploy setup:
  - **Two Firebase projects on Spark:** `card-scorekeeper-prod-1673f` for Production and
    `card-scorekeeper-staging` shared by every PR preview. Each has its own free quota, and
    preview code never touches real data or prod credentials. Open PRs share staging.
  - **Vercel stays the host.** All-Firebase would need Blaze for Cloud Functions, or a
    photo-count redesign on Firebase AI Logic (client calls through Firebase's proxy, gated by
    App Check instead of room membership). Revisit if public preview links matter.
  - **No Terraform.** Backends per PR are blocked by the free tier (one Firestore database per
    project, a small project quota), not by tooling. Provisioning is `firebase.json` (`location`,
    `auth.providers.anonymous`) plus one `firebase deploy --only firestore,auth --project <id>`;
    see the vercel-deploy skill.
- 2026-09-27 — First deploy fix: `/api/count` crashed on load on Vercel (`ERR_REQUIRE_ESM`).
  `firebase-admin/auth` loads `jwks-rsa`, which `require()`s the ESM-only `jose` v6. Node 24
  allows that; Vercel's function loader does not, and our checks ran plain Node, so only the real
  deploy showed it. ID tokens are now verified with `jose` directly (`api/_lib/id-token.ts`,
  Firebase's documented checks for third-party libraries), and `firebase-admin/auth` is no
  longer imported. `test:api-load` now runs with `--no-experimental-require-module`, which
  reproduces the failure locally. Pinning `jwks-rsa`'s `jose` to v5 was the alternative; rejected
  as a pin on an old major.
- 2026-09-27 — Stats results query: production Firestore refuses `documentId() in [...]`
  combined with the `participantUids array-contains` filter (`permission-denied`), while the
  emulator allows it, so every suite passed and Stats broke for anyone with a finished online
  game. Stats now loads `game_result` with the participant filter alone (one query, the exact set
  of games the player was in; the rules test for it already existed). The `game_player` queries
  work on prod unchanged, and none of the three need a composite index. Lesson: the emulator can
  be more permissive than production for rules on queries; the planned staging smoke check
  covers that gap.
- 2026-09-27 — Online Finish writes the stats before marking the room finished. Before, the room
  flipped to finished first: every device showed the winner at once, so Stats opened right then
  could miss the game (it surfaced as an e2e flake under load), and a failed stats write could
  never be retried because a finished room refuses every write. The rules for online stats only
  need the room to exist and the writer to be its host, so the order could simply swap, and
  `writeGameResult` skips docs that already exist, so a retried Finish is safe. This replaces the
  plan's "queue the online result first" idea for the review finding sync-5.
- 2026-09-27 — Scoreboard reveals scores per round (tester notes 4 and 8):
  - The board has five round columns before the total. During a round it shows only who has
    entered (✓, live); numbers, totals and ranking change when the host taps Next, and round 5 on
    Finish. This supersedes PLAN's "real-time" wording for score numbers: entries and the reveal
    still sync live with no refresh button, only the numbers wait. Past-round corrections and
    late joiners' missed rounds show at once, since those rounds are already revealed.
  - Totals and ranking come from revealed round scores (`lib/scoreboard.ts`), not the stored
    `totalScore`. A player with a revealed round still missing is unranked (no crown) until it's
    filled. `standings` stays the full live ranking for seat order, the Next gate and the winner.
  - Motion now exists: rows slide into the new order and changed totals fade in, both off for
    reduced motion via unlayered rules in `main.css` (this updates the slice-8 "no score motion"
    note). ContractBanner is no longer a live region; RoomView announces results, your place and
    the next contract together, the host hears when every score is in, and a reopened room
    announces nothing. Next and Finish use `aria-disabled` and wait for a score saved by the same
    tap, so one tap is enough; tapping early says whose scores are missing.
- 2026-09-27 — Back and Continue game (tester note 3, review finding ui-8):
  - The header has a Back control on every screen except Home. It goes to the previous screen in
    this tab, or Home when the page was opened directly (a room link, a new tab), detected by
    Vue Router's `history.state.back` being null. Owner's call: previous screen, but never out of
    the app.
  - Leaving a room doesn't end its game. Home shows "Game in progress" with the game still running
    in this session, the last online room this device was in (remembered in localStorage for
    the room lifetime, forgotten when the game finishes or the seat is lost) and an unfinished
    local game. The room lifetime constant moved to the pure `room-code.ts`.
  - Starting a new local game while an unfinished one is saved now asks first; before, it
    silently overwrote it. Online games never touch the saved local game, so they don't ask.
  - At 360px the header is full, so the Stats link is an icon on phones (still named "Stats") and
    the title truncates.
- 2026-09-27 — Unique player names (tester note 6):
  - A name is unique within a game, compared without regard to case or extra spaces: "Juho",
    "juho" and " Juho " are the same, "Mari Anne" and "Marianne" are not (owner's call). Names
    are stored cleaned (`cleanPlayerName`: NFC, whitespace runs collapsed, trimmed).
  - Online the check is on the server, because a joiner can't read the room's names before being
    seated. Every seat is created in one batch with `room/{code}/names/{key}`, owned by the same
    player; a second record under the same key is an update, which the rules never allow, so two
    people can't take one name even at the same moment. The rules derive the key from the stored
    name (`'n_' + lower`, '/' made id-safe) and refuse unclean names. Owner's call: strict from
    day one, no lenient phase for old clients, because the current data is test data that gets
    deleted before launch.
  - The rules' `lower()` only changes A to Z (found on the emulator: "Äimä" couldn't join, since
    the app keyed it "n_äimä" and the rules "n_Äimä"). So both sides lowercase A to Z plus a
    fixed list of Nordic capitals (Ä Ö Å Ü É Ø Æ) that the rules fold one by one. Any other
    capital is kept as typed: "Ωmega" and "ωmega" are two names. A rules test checks the app's
    key against the rules for each folded letter.
  - Consequences: players can no longer rename their seat (nothing did), the host's removal
    deletes the name record so the name is free again, and anyone signed in may read one name
    record, so a refusal can say "name taken" instead of a generic error.
  - Local games check the same keys in the setup form and in `LocalGameRepository.addPlayer`.
  - A failed join now resets the store, so Home never offers to continue a room this device
    never got into.
- 2026-09-27 — Play again (tester note 7):
  - Online, the host's Play again creates a new room first, then writes one field on the
    finished room, `nextRoomCode`. Every device still in it sees "The host started a new game"
    with "Join the next game", which seats them under their name from the finished game. A new
    room, not a reset of the old one: stats are stored per room, and a finished room never
    reopens (the /api photo gate trusts that).
  - The rules let a finished room take exactly that one write: by its host, before it expires,
    set once, pointing at another room the same host owns, and nothing else changes with it.
  - The host moves on even if the link doesn't land (an expired room refuses it); the new room's
    code is on screen to share instead. A link write that times out stays queued in the SDK.
  - Never a local game when the server can't be reached here: the other phones wait for that
    room, so the host gets an error and a retry (`nextRoomRepository`, online only).
  - A local Play again opens the setup form with the finished game's names, host first, passed in
    the history entry's state, so the host can add or remove players first.
  - `join()` now takes the seat before leaving the current game, so a refused join from a
    finished game leaves it on screen (with "Join with another name" when the name is taken)
    instead of an empty room. From an empty store it still leaves nothing behind.
  - Each room path gets a fresh RoomView (a keyed RouterView): Vue Router reuses the view when
    only the code changes, and a device keeps its anonymous uid across rooms, so which scores
    the host entered in the finished game would otherwise show a player's numbers early in the
    next one.
- 2026-09-27 — Production address rommi.vercel.app (second playtest):
  - rommi.vercel.app is the only production domain. The old card-scorekeeper.vercel.app was
    removed from the project outright, with no redirect (owner's call): nothing links to it
    and the test data is being wiped anyway.
  - Browser storage belongs to an address, so testers start fresh there: a new anonymous id,
    empty stats, no saved local game. An app installed to the home screen from the old address
    has to be removed and added again from the new one.
- 2026-09-27 — Gitflow with a test site (owner's call):
  - `develop` is the default branch; feature PRs squash-merge into it, and it deploys to
    test-rommi.vercel.app on staging Firebase. `main` is production (rommi.vercel.app). Testers
    play on test-rommi, so production holds only real games.
  - test-rommi is a Preview domain tied to `develop` in the same Vercel project, not a second
    project: the free plan has no custom environments, and the Preview variables already point
    at staging, secrets included. Vercel login protection on previews is off, so testers get
    in.
  - Releases fast-forward `main` to a `develop` commit (`git push origin develop:main`) when the
    owner says "release", with a release PR only for the record and CI. The owner asked for a
    PR without squash or merge commits; GitHub's "Rebase and merge" rewrites every commit id,
    so the fast-forward is the only way to keep both branches on the same commits. `main`'s
    ruleset therefore drops its PR rule but keeps required checks, linear history, no
    force-push and no deletion.
  - Hotfixes go through `develop` and a release, so `develop` must stay releasable.
- 2026-09-27 — Players without a phone: guest seats (second playtest, owner's call):
  - Names typed in the start form used to be ignored online (they only fed the local fallback).
    Now, in both modes, they become players the host scores for: online a guest seat, locally
    just another player. "Lisää pelaaja" at the end of the host's cards adds one at any round;
    added mid-game, they fill in the rounds they missed like a late joiner.
  - A guest seat's id is `guest-<lowercase uuid>`. An anonymous uid has no '-', so a guest id
    is never a signed-in identity and never a room member. The seat is owned by the host, its
    deviceUuid is its own id (the stats rows' key), and it carries `isGuest: true`.
  - Rules stay additive: new host-only branches create a guest seat and its name record, which
    also names the seat (`playerId`). The joiner and old-record branches are unchanged, so the
    rules can reach each environment before the app. The host already could write any seat's
    scores and total, and a stats row only needs the seat to exist.
  - The host always sees the numbers on a guest's card: nobody else can enter them.
  - A joiner who picks a guest's name is told the host already added that player and to ask the
    host to remove them. A phone taking over a guest seat is deferred.
  - Online Play again seats the finished game's guests in the next room, since they can't join
    by code.
  - Guest ids land in a stats row's participantUids alongside the uids; harmless, since nobody
    signs in as one. A guest gets a new id each game, as local players always have, so
    head-to-head lists a guest once per game. No photo count on guest cards.
