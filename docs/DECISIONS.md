# Decisions log

Why the app works the way it does. Format: `YYYY-MM-DD — decision`, with the reasons in
sub-bullets. Entries are appended, not rewritten: when a later decision replaces an earlier one,
the earlier entry ends with a "(Superseded: …)" note pointing at it. `PLAN.md` describes the app as
it is.

- 2026-07-24 — **Tie handling:** equal lowest totals are co-winners and share placement 1
  (standard competition ranking: 1, 1, 3). The least surprising rule for a friendly game, and
  placement stays usable for head-to-head.
- 2026-07-24 — **Contract data split:** `rules.ts` holds the 5 contracts as structured melds plus
  an i18n key per round; the words live in the locale files. The rules stay in code, the prose
  stays out of it.
- 2026-07-24 — **`GameRepository` seam:** one mode-agnostic interface. The game store gets a
  repository injected and imports no concrete one, so local vs online is a swap.
  - The host is a player: `createGame` seats the host first, `addPlayer` is for everyone else.
    Both repositories must uphold this; a test pins it.
  - `LocalGameRepository` saves best-effort: a failing `setItem` (iOS Safari private mode) never
    stops the live game.
- 2026-07-24 — **Online auth:** the Firebase Anonymous Auth uid is the identity the rules check
  (`request.auth.uid`). A device id carried as a field is spoofable, so rules couldn't enforce
  "own score vs host" with it. Seats and scores carry `ownerUid`; the room carries `hostUid`.
- 2026-07-24 — **Topology:** subcollections under `room/{code}` (`players/{uid}`,
  `roundScores/{uid}_{round}`, later `names/{key}`), not flat collections. Room scoping is
  structural: rules match `/room/{code}/**`, ownership is `docId == auth.uid`, expiry is one
  `get()` of the room.
- 2026-07-24 — **Read gate:** anyone signed in may `get` a room by code (joining needs it), but
  seats and scores are readable only by members (`exists(players/{auth.uid})`).
  - `allow get`, not `allow read`: `read` includes `list`, which let any signed-in stranger
    enumerate every room. The app never lists rooms.
- 2026-07-24 — **Trust model:** a player writes only their own scores; the host may correct
  anyone's. No server recomputes totals, and rules can't sum N docs.
  - Low total wins, so lowering your own score helps you. Rules therefore bound `points` and
    `round` (1–5), pin the doc id to `{ownerUid}_{round}` (one score per player per round, no
    double counting), and standings come from `roundScores`, never from the writable `totalScore`.
  - Accepted: a player can still claim 0 for their own round, the same as lying aloud at the table.
- 2026-07-24 — **Firebase loads lazily:** `firebase.ts` and the Firestore repository come in
  through a dynamic `import()` on first use. A static import put about 190 KB gzip into the first
  bundle, which an offline host would download before Home even painted.
- 2026-07-24 — **Slice-5 offline robustness:**
  - `getDb()`/`getFirebaseAuth()` are lazy getters, and `useGameConnectivity` wraps the whole
    online setup in try/catch. Any failure (blank `VITE_FIREBASE_*`, failed import, refused
    sign-in, probe timeout) sends the host to a local game and gives a joiner a friendly message.
  - Firestore uses `persistentLocalCache` with a single-tab manager when storage works, else
    `memoryLocalCache`, so iOS Safari private mode still runs. Multi-tab sync isn't needed.
  - A reload resumes a local game, but only on `/room/local`, so a stale local game can't appear
    on an online room's URL. This is the one place the store builds a concrete repository.
- 2026-07-24 — **Seat order only grows:** RoomView appends player ids as they appear. `start()`
  doesn't wait for the first snapshot, so a list frozen at mount could stay empty, and online
  players join mid-game.
- 2026-07-24 — **Next/Finish read synced `roundScores`,** not what this device entered. Online a
  device enters only its own score, so a local record never saw "everyone scored".
- 2026-07-24 — **Reconnect = push final result only:** a local game's Finish queues its result in
  localStorage (`pending-results.ts`), and the next online launch flushes it (`reconnect-flush.ts`).
  (Superseded in part: see the 2026-09-28 entry on offline results you can see, which also uploads
  when the browser comes back online and when Tilastot opens.)
  - `writeGameResult` is idempotent per doc (read before write). A partial failure is retried on
    the next launch, and the rules deny updates, so rewriting an existing doc would block that
    game, and every game queued after it, forever.
- 2026-07-24 — **Stats identity keying: stats rows key on the anon UID (the forgery fix).** A stats
  row's `deviceUuid` is the player's auth uid (their seat id), not the localStorage device uuid.
  - Without tying the row to `request.auth.uid`, any signed-in stranger could forge a permanent
    win or loss on anyone's stats. The forgery tests fail against the old rule.
  - **Create-authorization trade-off:** online (a room exists at the gameId), only its host
    writes, and only for a seated player. Local (no room) there is nothing to check against, so a
    row may only be the writer's own (`deviceUuid == auth.uid`). Only the host's row is queued,
    and the flush stamps it with the uid signed in at flush time.
  - Other players in a local game get a new id each game, so their stats never aggregate. History
    follows the device, not the person; not a bug.
  - `game_player` needs its `game_result` to exist first, so the two are sequential writes: a
    rule's `get()` doesn't see a sibling write in the same batch.
  - Accepted: a host can misreport a game played in their own room. Fixing that needs a server.
- 2026-07-24 — **Photo-count ID-token gate:** `/api/count` verifies the caller's Firebase ID token,
  then checks the room (exists, active, not expired) and the caller's seat. Not a self-asserted
  session token: a field in the body is forgeable, the same lesson as the forgery fix.
- 2026-09-27 — **Card values** are the house rule: 2–9 = 5, 10 = 10, J/Q/K = 10, Ace = 15,
  Joker = 25 (was face value). Every round score is a multiple of 5: `isValidRoundScore` checks it
  and the rules mirror it with `points % 5 == 0` on `roundScores`. `game_player` bounds stay loose,
  so a result queued offline under the old values isn't refused forever.
- 2026-09-27 — **2 decks, sometimes 3.** Scoring is per card, so `rules.ts` doesn't change. The
  Gemini prompt lists every copy of a card. No deck-count setting: its only use would be capping
  copies in a photo read.
- 2026-09-27 — **`test:integration` flake fixed** (the old known flake); the suite runs in CI.
  - The Node SDK's gRPC Listen stream loses its framing against the emulator
    (firebase/firebase-tools#8654). The suite now runs the SDK's browser build (WebChannel, what
    the app ships) under happy-dom.
  - A second flake failed only the exit code: happy-dom's `sendBeacon` rejection at teardown went
    unhandled. `tests/integration/beacon.setup.ts` drops the beacon's outcome, as a browser does.
    Flake checks count exit codes, not the "passed" line.
- 2026-09-27 — **CI:** Actions pinned by commit SHA, a read-only `GITHUB_TOKEN`,
  `workflow_dispatch`, and non-fixing `lint:check`/`format:check`. The v4 pins declared node20,
  which GitHub removed from runners on 2026-09-23.
  - e2e has its own job on a production build against the emulators. Playwright's CI server runs
    `vite build` first, because `VITE_*` values are baked in at build time. No retries, so a
    flake fails the job.
  - Playwright-WebKit is left out of the two-device specs: it falls back to long-polling and
    flakes. Live sync on a real iPhone still needs a check by hand.
- 2026-09-27 — **Review round 2, scores always land:**
  - One round-score cap, `MAX_ROUND_SCORE` (1000), in `rules.ts` and `firestore.rules`. The rules
    tests import the constant to pin parity. `-0` is rejected.
  - The flush moves permanently rejected results (`isPermanentWriteError`) to
    `pending-results-failed` and keeps going; transient errors stop it. Each success removes its
    own entry from a fresh read, so a game queued mid-flush survives.
  - RoomView shows an inline alert when a score, Next or Finish fails, and says the room is closed
    on permission-denied.
  - Light `--primary`/`--ring` #047857 and 80% focus rings for WCAG AA; `theme-contrast.test.ts`
    enforces the pairs.
- 2026-09-27 — **Review round 3a, owner decisions:**
  - Late joiners fill in the rounds they missed, instead of closing joins or a penalty. Next and
    Finish check every round so far, so nobody is ranked on fewer rounds.
  - Host powers online too: the host enters or fixes anyone's score and can remove another seat
    with its scores. Rules: `delete` for the host only, never their own seat, only while the room
    is live. A removed player can rejoin by code (accepted).
  - Seats are validated in rules: exact keys, name 1–40 characters, starting total 0, integer
    `joinOrder`.
- 2026-09-27 — **Review round 3b, connection resilience:**
  - Reachability is sign-in plus `getDocFromServer('room/probe')`. Sign-in alone is answered from
    cache for a returning device, so Wi-Fi without internet passed and Start then hung. Not
    `__probe__`: Firestore rejects ids matching `__.*__`.
  - Create and join time out after 10 s (`withTimeout`): the host falls back to a local game, a
    joiner is told the game is unreachable. The queued write may still land as an orphan room;
    accepted.
  - A reload resumes `/room/CODE` through `findSeat()` and an idempotent `addPlayer`.
  - Listener errors show "no longer in this room" (permission-denied) or "connection lost".
  - The launch flush doesn't load Firebase when nothing is queued. The local banner says "Playing
    a local game on this device", not "You're offline". (Superseded: see the 2026-09-28 fifth-round
    small fixes on `LocalGameBadge`, which says the same words.)
  - Still open: a "not synced yet" indicator, and showing the failed-results list. (Superseded in
    part: a waiting-to-upload count and the refused-results list shipped, see the 2026-09-28 entry
    on offline results you can see; there is no per-score "not synced" mark.)
- 2026-09-27 — **Review round 4, stats you can trust:**
  - Every `game_result`/`game_player` doc carries `participantUids`. Only participants can get or
    list, and every stats query filters `array-contains uid`. This replaced "stats readable by any
    signed-in user": with a public config, that meant anyone, not just friends.
  - Namespaces: room ids are room codes and local game ids are UUIDs, so neither can squat the
    other's stats. A local result's participants must be exactly its writer, which closes
    head-to-head injection.
  - Rooms: exact fields and at most 7 h expiry on create (6 h plus clock skew). Rounds advance one
    at a time, finish only in round 5, and never reopen. Round scores need a seated writer, a
    running game and a started round; a player may create a missed round, but only the host
    updates an earlier one.
  - `GameResult.winnerUuid` dropped: never read, and in the wrong identity namespace.
  - Security headers in `vercel.json`; the CSP stays Report-Only until checked on a deploy.
  - Deferred: App Check, and a room TTL. Online stats are keyed by room code, which is safe only
    while rooms are never deleted, so a TTL needs a per-game id first.
- 2026-09-27 — **Review round 5, photo count deployable:**
  - Ships on, with in-memory rate limits per instance (owner's call). The real ceiling is the
    no-billing key's free quota, so a seated player could use up the day's quota for everyone.
    Upgrade path: an Upstash/Redis `RateLimitStore`.
  - Model from `GEMINI_MODEL`, default `gemini-3.8-flash` (2.5 Flash is closed to new projects).
    Low thinking, capped output, 15 s abort, `maxDuration: 30`.
  - `api/` runs as native ESM on Vercel, so relative imports end in `.js`. `tsconfig.api.json`
    checks it and `test:api-load` loads the compiled function in CI.
  - Requests are checked before any I/O. Only `auth/*` token errors are 401. Gemini failures map to
    504, 503 or 502, and over 60 cards is 422. The sheet offers "Try again" only when a retry can
    work, and names each card input with its position, so copies from a second deck stay distinct.
  - The Gemini key lives in its own Google Cloud project, limited to the Generative Language API,
    never the Firebase browser key.
- 2026-09-27 — **Deploy setup:**
  - Two Firebase projects on Spark: `card-scorekeeper-prod-1673f` for production and
    `card-scorekeeper-staging` for `develop` and PR previews. Each has its own quota, and preview
    code never touches real data.
  - Vercel stays the host. All-Firebase would need Blaze for Cloud Functions, or a photo-count
    redesign on Firebase AI Logic gated by App Check.
  - No Terraform: the free tier (one database per project), not tooling, blocks a backend per PR.
    Provisioning is `firebase.json` plus `firebase deploy --only firestore,auth --project <id>`.
- 2026-09-27 — **Deploy fix:** `/api/count` crashed on load on Vercel (`ERR_REQUIRE_ESM`), because
  `firebase-admin/auth` loads `jwks-rsa`, which `require()`s the ESM-only `jose` v6. ID tokens are
  now verified with `jose` directly (`api/_lib/id-token.ts`), and `test:api-load` runs with
  `--no-experimental-require-module` to match Vercel's loader. Pinning `jose` v5 was rejected as a
  pin on an old major.
- 2026-09-27 — **Stats query:** production Firestore refuses `documentId() in [...]` combined with
  `participantUids array-contains`, while the emulator allows it. Stats loads `game_result` with
  the participant filter alone. Lesson: the emulator can be looser than production for query
  rules, so check on staging.
- 2026-09-27 — **Online Finish writes the stats before marking the room finished.** Otherwise
  Stats opened at the winner screen could miss the game, and a failed stats write could never be
  retried, since a finished room refuses every write. `writeGameResult` skips existing docs, so a
  retried Finish is safe.
- 2026-09-27 — **Scoreboard reveals scores per round:**
  - Five round columns and a total. During a round it shows only who has entered (✓, live);
    numbers, totals and ranking change on Next, round 5 on Finish. Entries and the reveal still
    sync live. Past-round corrections and missed rounds show at once.
  - Totals and ranking come from revealed rounds (`lib/game/scoreboard.ts`). A player with a
    revealed round still missing is unranked until it's filled.
  - Rows slide into the new order and changed totals fade in. Both are off for reduced motion
    through unlayered rules in `main.css`: Tailwind's `motion-reduce:` lost on source order inside
    `@layer utilities`.
  - RoomView announces results, your place and the next contract together. Next and Finish use
    `aria-disabled` and say whose scores are missing when tapped early.
- 2026-09-27 — **Back and Continue game:**
  - Back goes to the previous screen in this tab, or Home when the page was opened directly
    (`history.state.back` is null). Never out of the app (owner's call).
  - Leaving a room doesn't end its game. Home offers the game running in this session, the last
    online room (kept in localStorage for the room's lifetime) and an unfinished local game.
  - Starting a new local game over an unfinished one asks first.
- 2026-09-27 — **Unique player names:**
  - Unique within a game, ignoring case and extra spaces: "Juho" and " juho " are the same,
    "Mari Anne" and "Marianne" are not. Names are stored cleaned (`cleanPlayerName`: NFC,
    whitespace collapsed, trimmed).
  - Online the server checks it, because a joiner can't read the room's names before being
    seated. Each seat is created in one batch with `room/{code}/names/{key}`. A second record under
    the same key would be an update, which the rules never allow, so two people can't take one
    name even at the same moment. The rules derive the key from the stored name and refuse
    unclean names. Strict from day one (owner's call).
  - The rules' `lower()` only folds A–Z, so both sides also fold a fixed list of Nordic capitals
    (Ä Ö Å Ü É Ø Æ). Other capitals stay as typed. A rules test checks each folded letter.
  - Seats can't be renamed, removing a seat frees its name, and anyone signed in may read one name
    record, so a refusal can say "name taken".
  - A failed join resets the store, so Home never offers a room this device never got into.
- 2026-09-27 — **Production address rommi.vercel.app.** The old card-scorekeeper.vercel.app was
  removed with no redirect (owner's call). Browser storage belongs to an address, so testers start
  fresh there and reinstall the home-screen app.
- 2026-09-27 — **Gitflow with a test site** (owner's call):
  - `develop` is the default branch. Feature PRs squash-merge into it, and it deploys to
    test-rommi.vercel.app on staging. `main` is production. Testers play on test-rommi.
  - test-rommi is a Preview domain tied to `develop` in the same Vercel project: the free plan has
    no custom environments, and the Preview variables already point at staging.
  - A release fast-forwards `main` (`git push origin develop:main`) when the owner says "release",
    with a release PR for the record and CI. "Rebase and merge" rewrites commit ids, so only the
    fast-forward keeps both branches on the same commits. `main`'s ruleset keeps required checks,
    linear history, no force-push and no deletion.
  - Hotfixes go through `develop`, so `develop` must stay releasable.
- 2026-09-27 — **Guest seats** for players without a phone (owner's call):
  - The host adds them with the Add player card at any round, in both modes. Added mid-game, they
    fill in missed rounds like a late joiner.
  - The id is `guest-<lowercase uuid>`. An anonymous uid has no '-', so a guest id is never a
    signed-in identity or a room member. The seat is owned by the host, its `deviceUuid` is its own
    id (the stats key), and it carries `isGuest: true`.
  - The rules stay additive: new host-only branches create a guest seat and its name record, so
    the rules can deploy before the app. The host could already write any seat's scores.
  - The host always sees a guest's numbers. A joiner who picks a guest's name is told to ask the
    host to remove the guest. No photo count on guest cards.
  - Guest ids land in `participantUids`; harmless, since nobody signs in as one. A guest keeps its
    id into Play again's next room, otherwise gets a new one each game.
  - Known gap: an add that times out stays queued in the SDK and may still land, so retrying the
    same name can then say it's taken.
- 2026-09-27 — **Room code in the header, invite sheet, join links:**
  - In an online room the header shows the code with copy and Kutsu. Kutsu opens a sheet with a QR
    code of the join link, the code in large type, copy, and share (the share sheet, or copying the
    link where there is none).
  - The link is `/join/CODE`, built from the current address, so previews and test-rommi link to
    themselves. The page asks only for a name and checks `roomAvailability()` first.
  - The QR comes from `uqr`, loaded when the sheet opens and drawn as one SVG path, dark on white.
    Copying uses the Clipboard API with a textarea fallback (`useCopyText`); VueUse's
    `useClipboard` needs a permission query that Firefox and Safari lack.
- 2026-09-27 — **Sticky header:** only the top bar stays on screen, and everything else, the
  scoreboard included, scrolls with the page (owner's call, after a pinned board was tried).
  `html { scroll-padding-top }` equals the header height, so anything scrolled or focused into view
  lands below it.
- 2026-09-27 — **Rules page** (`/rules`): contracts from `CONTRACTS`, example melds, and card
  values from `cardValue`, so the page can't drift from scoring. Precached, so it opens offline.
  - Owner's rule: an ace is 1 or 14 in a flush, never both, so K-A-2-3 doesn't count.
  - Drafted on assumptions for the owner to correct: a flush is 4+ cards, a set may repeat suits,
    a joker stands in for any card, twos are not wild.
  - Cards are white in both themes. The suit symbol tells suits apart, and each card has a spoken
    name.
- 2026-09-27 — **The open card and the phone keyboard:**
  - A phone scrolls a field out from behind its keyboard only when the finger tapped that field,
    not when the app focuses it. On touch, an opening card scrolls up under the header before its
    field is focused (`useKeepInView`, `scrollToTop`), and the room adds space below an open card
    (`--open-card-room`) so the last one can come up. With a mouse, a card just moves clear of the
    header and the Next bar.
  - Don't follow `visualViewport` resizes: an iPhone also resizes while scrolling, and the page
    jumped back mid-scroll. A unit test pins that a resize never scrolls.
  - The sticky Next bar sat on top of the field, right above the keyboard, so the room's bottom
    bars stop sticking while a card is open (`:has([data-card-open])`).
  - Android Chrome gets `interactive-widget=resizes-content`. Keyboard behaviour can only be
    checked on a real phone.
- 2026-09-27 — **"Syötä kaikki"** for the host, shown while anyone is missing a score this round. A
  sheet goes through those players one at a time, laid out like an open score card, with ✓ (save
  and next) and Skip. A player who enters their own score meanwhile drops out.
  - The field stays the same element, so the keyboard stays up. The sheet floats in the upper part
    of the screen (`--floating-sheet-top`): an iPhone centres on the whole screen, so a centred
    field lands behind the keyboard.
  - Saving goes through the room's own handler, so announcements, errors and which numbers the
    host may see work as they do for the cards.
  - ✓ and Skip hand focus straight back to the field while the tap is handled (`mousedown.prevent`
    with a mouse). Refocusing after the save's network wait no longer counted as the tap on an
    iPhone, and the keyboard dropped. Skip sits on the bottom row (owner's call).
- 2026-09-27 — **One form on Home:** one card with a Liity | Uusi peli toggle, Liity first, since
  most people at a table join. The name field is shared.
  - No other players in the start form: the host adds them in the room as guests, or they join.
  - A local Play again starts the next game at once with the same players in the same order.
- 2026-09-28 — **Online Play again takes everyone along:**
  - A new room, not a reset of the old one: stats are stored per room, and a finished room never
    reopens (the photo gate trusts that).
  - The host creates the next room naming the finished one (`previousRoomCode`), links the
    finished room to it (`nextRoomCode`, set once), then seats everyone as they were: same ids,
    names and order, guests included. Each seat is its own write, so one failure doesn't stop the
    rest.
  - Other phones watch for their own seat in the next room (a player may read their own seat
    before having one) and move there. "Join the next game" stays for when no seat comes.
  - **Carried seats** in the rules: the host may seat another player's uid only in the one room the
    finished room points at, before that game starts, with the same name and device, and a name
    record that is the player's own. Linking first stops a host from seating a former player in
    any number of rooms and writing stats for games that player never saw. Accepted: a host can
    take the same people along into each next game; they see every one on their phones.
  - The rules change is additive, so older apps keep working. The new app needs the new rules, so
    they go to production before the release.
  - Never a local fallback here: the other phones wait for that room, so the host gets an error
    and a retry. `join()` takes the seat before leaving the current game, so a refused join keeps
    the finished game on screen.
  - Each room path gets a fresh RoomView (a keyed RouterView). Vue Router reuses the view when only
    the code changes, and a device keeps its uid across rooms, so the host's view would otherwise
    show a player's numbers early in the next game.
- 2026-09-28 — **Menu rows and installing the app:**
  - Kieli, Teema and the pages are whole-width rows. Tapping Kieli flips the language.
  - "Asenna sovellus": Android Chrome and desktop Chromium fire `beforeinstallprompt`, caught at
    startup (the install store) because it can fire before the menu opens. No iPhone browser fires
    it (they all run WebKit), so there the row shows Share, then Add to Home Screen, with where
    Share sits in each browser. Other Android browsers get the browser-menu steps. The row is
    hidden once installed, or where installing isn't possible.
  - The app is called "Rommi" everywhere: manifest, `apple-mobile-web-app-title`, page and menu
    title.
- 2026-09-28 — **Folders:** `src/` keeps its layers, split by area:
  `components/{home,room,header,menu,stats,rules}` and `lib/{game,data,platform}`. `lib/utils.ts`
  stays because the shadcn CLI imports it there.
  - The repo root keeps only what tools look for: rules in `firebase/`, Playwright in
    `tests/e2e/`, commitlint config in `package.json`, and one `vitest.config.ts` with a project per
    suite. `tsconfig.api.json` stays at the root: inside `api/`, Vercel would treat it as a
    function.
  - CI runs e2e with 3 workers, since each test makes its own rooms.
- 2026-09-28 — **Small fixes (fourth round):**
  - The app frame is the full-height flex column and each view is `flex-1`. `min-h-dvh` views
    under a sticky header always showed a scroll bar.
  - A round can't have two zeros (`roundsWithSeveralZeros`): Next and Finish stay disabled and the
    host sees which round to check. "At most one", not "exactly one". (Superseded: see the
    2026-09-29 sixth-round entry, exactly one 0, and the 2026-09-28 round-flow entry, judged only
    for the round being closed.)
  - "Vain tällä puhelimella" under Uusi peli starts a local game without the probe, for a table
    where nobody else has a phone. Off by default, remembered per device. (Superseded: renamed
    "Vain tällä laitteella", see the 2026-09-29 sixth-round entry.)
- 2026-09-28 — **Score entry:**
  - A card saves only on ✓ or Enter; leaving the field saves nothing. A tap outside the open card
    closes it and drops the typed number, and so does another card opening: one card is open at a
    time (`useSingleOpenCard`). A tap is a `pointerup`; a scroll ends in `pointercancel`, so
    scrolling never closes a card. Taps inside a dialog don't count.
  - A number typed but not saved when Next is tapped is dropped, so Next says whose score is
    missing.
  - Removing a player asks in an AlertDialog with ✕ (keep) and 🗑 (remove). Focus starts on ✕.
- 2026-09-28 — **Themes and app updates:**
  - Teema: Tumma (default), Vaalea, Jani, Nord, Dracula, Solarized. Colours that failed AA were
    adjusted, and `theme-contrast.test.ts` checks every palette. (Superseded: see the 2026-09-29
    entry on the Kapteeni themes; Kapteeni is the default, Tumma and Vaalea are now Vihreä.)
  - Each palette is a `.theme-<id>` class; the dark ones also carry `dark`. The list lives in
    `lib/platform/themes.ts`, and index.html's no-flash script repeats it (a test keeps them
    equal). The theme is stored as a raw string, not through pinia-persistedstate, which would
    JSON-wrap it and break the no-flash script. The CSP's script hash follows the script, and
    `theme-color` follows the theme.
  - Updates: the browser only looks for a new service worker on navigation, and an installed app
    may stay open for hours. It now checks every 30 minutes and when it comes back on screen. A
    waiting version shows in the menu and the banner, never as an automatic reload mid-game.
- 2026-09-28 — **Global highscores** (owner's choice: best game, hall of shame and biggest round;
  "most wins" later, as its cost grows with every game) (Superseded in part: "most wins" came
  with the 2026-09-28 entry on global player lists):
  - `leaderboard/{gameId}_{deviceUuid}`, one entry per stats row, written right after the row.
    Readable by anyone signed in, at most 10 per query.
  - **Leaderboard trust:** the rules accept only an entry that copies its own `game_player` row
    (and the game's `finishedAt`) exactly, written by one of that game's players. So who may write
    a stats row decides what reaches the board. A host could still enter made-up scores in their
    own game; accepted when choosing a global board. (Superseded in part: see the 2026-09-28
    second-audit PR 3 entry; only a finished online room with two or more players counts.)
  - Names on the board are public to anyone holding the public web config (anonymous sign-in).
    The entry id carries the game code and the player's anonymous uid (see 2026-09-28 below).
  - An entry is an extra: if it can't be written, the game still finishes and the entry is left
    out, not retried. (Superseded: see the 2026-09-28 second-audit PR 4 entry; a passing failure
    is now queued and retried.)
  - At the next release, the production games played since the wipe get their entries copied in
    once.
- 2026-09-28 — **Visual snapshots** with Playwright, not Chromatic, whose free 5,000 snapshots a
  month our PR pace would use up:
  - `tests/e2e/visual.spec.ts` covers the key screens in Finnish, dark and light, from a local
    game, so nothing changes between runs.
  - Screenshots only match where fonts render the same, so they run in Playwright's Linux image on
    x86: `pnpm test:visual` and `test:visual:update` through Docker (`tests/e2e/visual.sh`), and
    CI's `visual` job in the same image. The image tag follows `@playwright/test`.
- 2026-09-28 — The connection check waits up to 8 s, not 3 s. A CI trace showed why: the anonymous
  sign-in took 0.1 s, but the first Firestore read on a cold connection took 2.7 s, so the host
  landed in a local game that nobody can join. A slow phone network hits the same. "Checking the
  connection…" shows meanwhile, and a device known to be offline still skips the wait.
- 2026-09-28 — Error reports go to Sentry (fourth round). Better Stack takes the same SDK and has
  more free room, but Sentry's source-map upload and issue grouping won; switching later only
  changes the DSN.
  - Free Developer plan, EU region (`ingest.de.sentry.io`), org `juho-lahtinen`, project `rommi`.
    One user: the owner. The app's players aren't counted, only errors (5,000 a month).
  - Only builds with `VITE_SENTRY_DSN` report: Vercel's Production and Preview, not local or CI,
    where the SDK isn't even bundled. The environment follows the branch (main → production,
    develop → test, other branches → preview), and the release is the commit.
  - The SDK loads after the app starts, in its own chunk, so neither the first paint nor an offline
    host waits for it. The whole SDK is imported, as the owner asked, not trimmed to what's used.
  - Tracing and replay are on (the owner enabled them in Sentry): every page load and route
    change is traced, and replays cover only sessions that hit an error (the last minute is kept
    in memory and sent then). The free plan's replay quota simply stops recording when used up.
  - Privacy: room codes are cut from every report, streamed span, breadcrumb, replay recording
    and replay event (2026-09-28: Sentry 11 streams spans, so `beforeSendTransaction` never ran;
    now `beforeSendSpan`, `beforeAddRecordingEvent` and a global event processor); click
    breadcrumbs are off because button labels carry player names; component props are off
    (`attachProps: false`) for the same reason; replays mask all text and block media; no user
    info, cookies, bodies or query params (only the User-Agent header). Replay's compression
    worker needs `blob:` in the CSP's `worker-src`.
  - Source maps: built hidden, uploaded by `@sentry/vite-plugin` with `SENTRY_AUTH_TOKEN` (a
    Vercel secret; the token carries Sentry's address), then deleted, so browsers never get them. `@sentry/cli`'s install script is
    denied in pnpm-workspace.yaml; its binary comes from the per-platform package.
  - The CSP allows `https://*.ingest.de.sentry.io`. The Sentry MCP server is set up locally for
    reading issues.
- 2026-09-28 — Failures leave things as they were (found while trimming comments): starting a
  game that can't be created keeps the current one; a join whose seat lookup fails after the seat
  was taken keeps the current game on screen (a retry finds the seat); blocked storage that throws
  on read means "nothing saved", not a crash; and a local finish builds the host's stats row
  before marking the game finished, so a damaged save can't end up finished with nothing to sync.
- 2026-09-28 — Small fixes (fifth round):
  - "Peli kesken" opened the same game from both buttons: the room page showed whatever game was
    already open in the store, whatever its address said. It now leaves another open game first
    (a local one stays saved, an online one stays remembered) and opens the game its address
    names.
  - The local-game box above the scores became a no-wifi icon in the header (`LocalGameBadge`);
    a tap shows the same words. The room still says them once to screen readers.
  - V–H–T in head-to-head gets an ⓘ: voitot, häviöt, tasapelit against that player.
  - Vitest already runs the unit files in parallel (about 5 s). CI's e2e job now caches the
    Playwright browsers per version instead of downloading them on every run.
- 2026-09-28 — Ending a game early (fifth round; the owner chose "abandon, no stats"):
  - A new room status, `abandoned`: only the host sets it, from waiting or playing. Like a
    finished room it then takes no rounds, scores or guest seats, never reopens, and no stats
    can be written for it (the host's `game_result` create checks the status). Nothing about it
    reaches Tilastot or the highscores.
  - In a room, the menu gets "Tämä peli": the host's "Lopeta peli" ends it for everyone (on a
    local game it deletes it), a player's "Poistu pelistä" only leaves it here and their seat
    stays for the host to remove. Both confirm first; ending shows an error and stays put if it
    doesn't go through. Every other phone in the room sees "Peli lopetettiin" and forgets it.
  - Home's "Peli kesken" rows get ✕ (the owner's call: it depends on who you are). Home can't
    tell who hosts a room without asking the room, so ✕ asks it: the host ends the game, a player
    just forgets it; without a connection it's only forgotten here, which the confirm says.
  - The store's `leave()` now clears `gameId` and `roomCode` too, so an ended game doesn't linger
    as "in progress".
- 2026-09-28 — Global player lists (fifth round; the owner chose most wins, best win rate, best
  average and most games):
  - Reading every game for "most wins" would grow with every game. Instead each player (auth uid
    or guest id) has a running total, `player_totals/{playerId}`: games, wins, score sum, and the
    derived win rate, average and `qualified` (at least 5 games, `QUALIFYING_GAMES`). Each list
    is then one query of 10 reads, like the game records.
  - The totals change in the same transaction that publishes a game's leaderboard entry. The rules
    accept a write only if it counts exactly the stats row its `lastEntry` names (one more game,
    a win if that row placed first, its score), in the write that creates that row's entry, by
    one of that game's players. An entry can only be created once, so each game counts once. The
    derived fields must equal what `nextPlayerTotals` computes; the rules use `float()` because
    dividing two ints there truncates (a test pins a third). The transaction retries if two games
    finish with the same player at once.
  - Win rate and average rank only qualified players, which needs two composite indexes
    (`firebase/firestore.indexes.json`), deployed with the rules.
  - Tilastot's records split into tabs: Pelaajat (the four player lists, each with its game count)
    and Pelit (best game, hall of shame, biggest round). (Superseded: see the 2026-09-28 entry on
    Ennätykset's own page and the 2026-09-29 sixth-round entry on `SegmentedToggle`.)
  - Totals start with this release; at the release they're built once from the production games,
    together with the highscore entries.
- 2026-09-29 — App icon and the Kapteeni themes. The owner asked for icons like the Captain Morgan
  logo; that's a registered trademark, so the icon is an original design in the same spirit:
  a tricorn over a vintage serif R in a gold frame, on label red (concept B). `node
  scripts/render-icons.mjs` renders the PWA icons, the maskable one (the mark without the frame,
  inside Android's safe circle), the iPhone icon and the favicon; it needs the network for the R's
  typeface. The logo also sits beside "Rommi" in Home's header.
  - Kapteeni is the new default theme, matching the icon: brown-black, gold actions with dark
    text, label-red brand. Kapteeni vaalea: cream paper, label-red actions. Red isn't the dark
    theme's action colour because danger is red too; danger uses a separate coral (dark) or
    orange-red (light), always with an icon or words. A new `--brand` token (primary elsewhere)
    colours the app's name and the leader's crown.
  - The emerald themes stay as Vihreä and Vihreä vaalea (ids `dark` and `light`, so a stored
    choice keeps working). Only a device with no stored choice moves to Kapteeni. The manifest
    and `theme-color` are brown-black to match; the contrast test covers both new palettes and
    the brand colour in every theme.
- 2026-09-29 — Sixth round of notes:
  - A completed round needs exactly one 0 (`roundsWithoutWinner` joins `roundsWithSeveralZeros`):
    someone always goes out. Next and Finish stay disabled, with a line naming the round, until
    it's fixed. A round still being scored isn't judged.
  - "Vain tällä laitteella", not "puhelimella": the switch works the same on a computer.
  - The points field steps by 5 (`step="5"`), so the desktop spinner arrows and the arrow keys
    move in valid amounts. iOS shows no spinner either way.
  - An online player sees "Odotetaan, että isäntä siirtyy seuraavalle kierrokselle" only once
    their own points for the round (and any missed rounds) are in.
  - Tilastot's Pelaajat | Pelit toggle looked broken: shadcn's tab styles key on `data-active`,
    but Reka marks the chosen tab with `data-state`, so the selected tab never looked selected.
    Both it and Home's Liity | Uusi peli now use one `SegmentedToggle` (pressed buttons in a
    labelled group); the shadcn tabs are gone.
  - A scanned invite QR opens the installed app on Android (a Chrome-installed app catches links
    in its scope from outside the browser; `handle_links: 'preferred'` and `launch_handler`
    make it explicit and reuse the open window). iOS can't: home-screen apps can't catch links.
  - Keeping the open card above the keyboard stays as it is. There's no cross-browser standard:
    Android gets `interactive-widget=resizes-content`, the VirtualKeyboard API is Chromium-only,
    and on an iPhone the keyboard covers the page without resizing it, so the last card can only
    rise above it if there's page below. Following `visualViewport` fought the player's scrolling.
- 2026-09-28 — Offline results you can see. Tilastot shows how many finished local games wait to
  upload, and the ones Firestore refused for good. The queue no longer uploads only on launch:
  also when the browser comes back online and when Tilastot opens, one upload at a time.
  - Each queued write has a 15 s bound: an offline Firestore write never fails, it waits, so an
    unbounded upload would stay "in flight" and block every later try.
  - A refused game gets Yritä uudelleen, not only Poista: a refusal can be the rules being behind
    (a release not yet deployed), so after a rules fix it may go through. Poista asks first.
- 2026-09-28 — Ennätykset got its own page (`/highscores`, a menu row after Tilastot). Tilastot
  had grown to caveats, upload notices, your record, head-to-head and seven global lists; now it
  is this device only, and "Tietoa tilastoista" is an ⓘ by the heading (`InfoPopover`, shared
  with the V–H–T legend).
- 2026-09-28 — A score save is one write. `setRoundScore` used to read the player's round scores
  from the server and update the seat's `totalScore` in a batch, so a saved score showed only after
  a server round trip. The list then jumped under the next tap, which made Firefox's e2e flake on
  CI (a click whose mouse-up landed on the shifted card), and offline the read held up the save.
  Nothing read `totalScore`: totals are summed from `roundScores` (the store, `finishGame`, and now
  the repository's emitted state). The seat field stays (the rules require 0 on create and older
  prod clients still update it) and can go in a later rules change.
- 2026-09-28 — Round flow can't double-fire or lock (second audit, PR 2).
  - Next/Finish set their busy flag before waiting for the last save; `advanceRound(fromRound)`
    writes `fromRound + 1` with no read, so a repeat (double tap, retry, second tab) writes the
    same round. The rules already accept an unchanged round.
  - "No zero" is judged only for the round being closed. Owner's choice: a removed player's
    scores are still deleted, so an earlier round can lose its zero; it passed when it closed.
  - `finishGame` checks `canFinishGame` itself, on fresh reads (online) or its state (local), and
    throws `GameIncompleteError` before writing anything permanent.
  - Next/Finish wait at most 5 s for a just-saved score. Offline, a Firestore write's promise
    never settles, so instead of a silent busy button that fires on reconnect they say "no
    connection". advanceRound is bounded too; retrying it is safe because it is idempotent.
- 2026-09-28 — Input edges (second audit, PR 2b). Enter saves on keydown, not keyup: Enter on a
  card header opened it and the same key's keyup then saved or said "enter the points first". A
  held Enter or an IME confirmation doesn't save. A photo retake clears the previous result and
  only the newest read counts, so a hidden old total can't be confirmed. A timed-out end game says
  it ends once the phone is back online (the write stays queued), not that it failed.
- 2026-09-28 — Ended rooms stay closed; the public lists count online games only (second audit,
  PR 3).
  - A seat can be created only while the room is waiting or playing. Before, a stranger could sit
    down in a finished room (shown as the winner on every phone still on it, then carried into the
    next game by Play again) or in an abandoned one. Late joiners during play are unaffected.
  - Owner's decision: the leaderboard and player_totals accept an entry only for a finished online
    room with at least two participants (guests count: a guest is a real person without a phone).
    A local game is three self-written docs any script could forge; it now feeds Tilastot only.
    Highscores are published after the room is marked finished, so the rule can check it.
  - Accepted, for now: someone scripting two anonymous accounts through a real room can still
    forge an entry, and an entry id still carries its room code, so a finished room's code (and its
    `nextRoomCode`) is public. The next room is joinable like any room whose code is known; the
    host sees newcomers and can remove them. App Check is the fix for both and is still open.
  - `finishedAt` must be an ISO timestamp (`YYYY-MM-DDTHH:MM:SS.sssZ`); the Ennätykset list also
    skips an unreadable date instead of failing to render.
  - `isGameOver(status)` in rules.ts is the one "room is over" check (store, repository, JoinView,
    and the photo gate, which now also refuses an abandoned room).
- 2026-09-28 — Highscores that arrive, failures that leave a trace (second audit, PR 4).
  - A retried online Finish reuses the stored `game_result` (its `finishedAt`), which the rules
    match entries against; before, every entry of a retried Finish was refused silently. A retry
    whose room is already finished skips that write and still publishes.
  - An entry that fails for a passing reason (offline, a contended transaction) is kept in
    `card-scorekeeper:pending-highscores` and retried with the result queue (launch, back online,
    Tilastot). Refused ones are dropped; each entry is written once, so a retry can't count twice.
  - `reportHandledError` sends recovered errors to Sentry as warnings (no-op without a DSN):
    highscore publishes, Tilastot and Ennätykset loads, the reconnect flushes, refused queued
    results, and the online-setup fallbacks. A broken prod backend no longer degrades silently.
  - `tests/e2e/highscores.spec.ts`: a finished online game shows on Ennätykset.
- 2026-09-28 — Privacy (second audit, PR 5). A Tietosuoja page in the menu says what stays on the
  device, what Firebase stores (in europe-north1) and for how long a room is joinable, that ids
  are anonymous, that highscores are public and permanent, that a photo goes to Gemini and isn't
  kept, and what error reports carry. Sentry's scrubbing now covers streamed spans and replays,
  and props are off (see the Sentry entry). A malformed `FIREBASE_SERVICE_ACCOUNT` now fails with
  a fixed message: V8's JSON error quotes the input, which would put key characters in the logs.
- 2026-09-28 — Accessibility and small screens (second audit, PR 6).
  - Focus never drops to `<body>`: Next moves it to the new round's heading, Finish to the page
    heading, Enter-all closing itself to its button or the round heading, and the Home ✕ to the
    page heading. Next and Finish are no longer `disabled` while busy (a focused button that
    becomes disabled loses focus); they are aria-disabled and the busy flag ignores the tap.
  - The winner is announced through the room's persistent live region, like every reveal: a
    live region inserted with its text already in it (the old WinnerBanner) is often not read.
  - Destructive text meets 4.5:1 on its own tint (dialogs, the rules badge) and on `muted` in all
    eight themes; the destructive red moved in five of them, and the contrast test checks these
    pairs now.
  - Blocked site data no longer gives a blank page: `browserLocalStorage()` itself is safe (reads
    find nothing, writes are dropped), locale and theme go through it, and the no-flash script
    catches too (new CSP hash).
  - At 360 px the header hides the word "Huone" (still read out) so the room code never
    truncates (`xs` breakpoint, 24rem).
  - Reopening an online room offline on a cold cache says "No connection" and retries on the
    `online` event, instead of "This room isn't open on this device".
- 2026-09-28 — Coverage gates (owner's target, second audit PR 8). 100% lines, branches,
  functions and statements on `src/lib`, `src/stores`, `src/composables` and `api/_lib`; a floor
  that only rises on components and views; enforced in CI by `pnpm test:coverage`. The owner
  asked for 100% and invited pushback: 100% everywhere would mostly buy tests that execute
  template lines without checking them, so the UI gets a ratchet instead. Excluded, with the
  reason in `vitest.config.ts`: the owned shadcn `ui/` copies and pure SDK/runtime wiring that
  the emulator suites, `test:api-load` and production exercise.
- 2026-09-28 — Leftovers from the second audit (PR 9).
  - Card values are tested against literal points, plus hands a swapped ace/face value or a
    changed 10 would break; the old tests compared each constant with itself.
  - `playerStats` is tested with an opponent holding every extreme, so only the device's own rows
    count. A rules test publishes QUALIFYING_GAMES + 1 games with totals from `nextPlayerTotals`,
    so the client and the rules' `addsUp` can't drift apart.
  - Every write the user waits on is now bounded, removing a player and finishing included; a
    score save stays unbounded on purpose (it shows at once, and Next waits at most 5 s for it).
  - Safari's 7-day storage cap for sites that aren't installed is stated where it matters
    (Tilastot's ⓘ, the privacy page, PLAN); installing is the fix.
- 2026-09-28 — One way to build stats rows, and store reads in lib/data (second audit, PR 10).
  `gamePlayerRows` in lib/game/stats.ts builds a finished game's rows for both repositories
  (ranked on totals from the round scores; before, the local one ranked on stored totals). The
  Tilastot and Ennätykset reads moved out of their stores into `lib/data/stats-reads.ts`
  (`connectIfReachable`, `readPlayedGames`, `readTop`); the stores only map results to state,
  as the layering says. Still to do: `deviceUuid` names three different ids (the identity
  store's, a seat field and the stats key), which touches the Firestore schema the rules check.
- 2026-09-28 — The highscore backfill (release step 3). `pnpm backfill:highscores --project <id>`
  (dry run unless `--write`), with a pure planner in lib/game so it's unit-tested and inside the
  coverage gate. It runs between the rules deploy and the app, when nothing else publishes, and
  rebuilds totals instead of incrementing them, so it is safe to rerun. Credentials come from
  Application Default Credentials, never a key in the repo. `tsx` runs it; esbuild's install
  script stays denied (its binary comes from the per-platform package).
