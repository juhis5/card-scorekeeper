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

## Carried-forward TODOs (flagged by implementers, not yet wired)

- Slice 3: call `identityStore.ensureDeviceUuid()` at app bootstrap / first start-join — nothing
  wires it yet, so `deviceUuid` stays `''` until then.
- Slice 4: the game store's only entry is `start()` (host: calls `createGame`). The online JOINER
  path needs a new store action (e.g. `join(repo, code)` that subscribes/addPlayer without
  createGame). The interface itself is stable; the store gains an action (not zero change).
