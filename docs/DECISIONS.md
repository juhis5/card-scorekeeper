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

## Carried-forward TODOs (flagged by implementers, not yet wired)

- ~~Slice 3: call `identityStore.ensureDeviceUuid()` at app bootstrap~~ — DONE in slice 3 (wired in
  main.ts before router, so identity is set before the first nav guard).
- Slice 4: the game store's only entry is `start()` (host: calls `createGame`). The online JOINER
  path needs a new store action (e.g. `join(repo, code)` that subscribes/addPlayer without
  createGame). The interface itself is stable; the store gains an action (not zero change).
- Slice 5: reload/resume of an in-progress LOCAL game. `LocalGameRepository` persists to
  localStorage, but the game store doesn't re-subscribe on mount — a hard reload mid-game loses
  the in-memory store (repo data survives, nothing reads it back). RoomView degrades gracefully
  (empty state → back home, no crash). Wire resume where offline robustness lives (slice 5).
- Slice 6 (stats): local non-host players get a fresh synthetic `crypto.randomUUID()` per game
  (slice 3), so their stats won't accumulate across local games. PLAN didn't pin local-player
  identity; reconcile when building stats (device-UUID model assumes real devices).
- Slice 8 (polish): slice 3 UI is behavior-tested + static-checked (tokens/a11y/i18n) but not yet
  visually verified in a real browser at a phone viewport — do the cross-platform visual pass here.
- Slice 4b: ONLINE UI must handle two things slice 4a surfaced — (a) each player enters only their
  OWN score online (rules enforce it; host may correct anyone), unlike local mode where the host
  enters everyone; (b) online room `status` stays `'waiting'` until the HOST first calls
  `advanceRound()` (the room-doc update is host-only, so `setRoundScore` can't flip status the way
  LocalGameRepository does) — don't gate the scoreboard UI on `status==='playing'` for round 1.
  Also: 4b's e2e needs BOTH firestore + auth emulators + `connectAuthEmulator` (`VITE_USE_EMULATOR`).
- CI: `.github/workflows/ci.yml` has a commented `test:rules` job — wire it now that rules exist
  (needs Java + firebase-tools on the runner). Do in 4b or polish. Do NOT add `test:integration`
  to CI (see flake below).
- KNOWN FLAKE (accepted, fenced off): `pnpm test:integration` (emulator-backed FirestoreGameRepository
  test) intermittently fails on a cold-booted emulator via Vitest — a Node24 + grpc-js + emulator
  HTTP/2 cold-boot transport race (browser uses WebChannel, so NOT a product bug). Isolated into its
  own `vitest.integration.config.ts`, OUT of `test:run`/CI/hooks. The join-order correctness it
  demonstrates is ALSO covered by a deterministic store-level `callOrder` unit test. Per tdd's flake
  rules this is the "quarantine with documented root cause" path, not a silent skip.
