# Rommi scorekeeper: the app as it is

This file describes what the app does today. `DECISIONS.md` says why it works this way,
`CLAUDE.md` and `.claude/skills/` hold the conventions, and `TOOLCHAIN.md` the versions.

## What it does

A live scoreboard for Rommi (Finnish Rummy), made for a phone held in one hand at a card table.
A host starts a game and the others join with a room code, a link or a QR code. Each player
enters their own score every round, the host can enter or fix anyone's, and every phone follows
the game live. The lowest total after five rounds wins. With no connection, the host can run the
whole game on one phone. Finished games feed per-player stats and global highscores. An optional
photo count reads a picture of the cards left in a hand and suggests the points.

## The game: confirmed rules

- Played with 2 decks (sometimes 3), jokers included, so duplicate cards are normal. Scoring
  counts every physical card left in the hand when someone goes out.
- Card values: 2–9 = 5, 10 = 10, J/Q/K = 10, Ace = 15, Joker = 25. A round score is a multiple
  of 5, at most 1000. Only the player who went out scores 0: exactly one zero per round.
- Five fixed rounds, each with a contract: two sets of three; a set and a flush; three sets; a
  flush and two sets; two flushes and a set. A set is 3+ cards of one rank, suits may repeat. A
  flush is 4+ cards in sequence in one suit; an ace is 1 or 14, never both. The contract is a
  reminder; the app never checks melds.
- Lowest total wins. Ties share the place (1, 1, 3).
- All of this lives in `src/lib/game/rules.ts`. The rules page renders contracts and card values
  from that file, so it can't drift from the scoring.

## Screens

- **Home** (`/`): one card with a Liity | Uusi peli toggle and a shared name field. Liity also
  asks for the room code. Uusi peli has a "Vain tällä puhelimella" switch that starts a local
  game without checking the connection. "Game in progress" links back to an unfinished game.
- **Room** (`/room/CODE`, or `/room/local`): the round banner, the scoreboard, a score card per
  player, and the host's Next or Finish bar. The host also gets an Add player card and "Syötä
  kaikki", a sheet for everyone still missing a score. After Finish: the winner and Play again.
- **Join** (`/join/CODE`): what an invite link or QR code opens. It asks only for a name, and
  says so first when the room has finished, expired or doesn't exist.
- **Stats** (`/stats`), **Rules** (`/rules`) and a 404 page.
- **Header**, sticky: Back (not on Home), the room code with copy and Kutsu (a sheet with a QR
  code and a share link) in an online room, and the menu: Tilastot, Ennätykset, Säännöt, Tietosuoja, Kieli,
  Teema (eight themes), Asenna sovellus, and Päivitä sovellus when a new version is waiting.

One score card is open at a time and saves only on ✓ or Enter; a tap outside drops the typed
number. The scoreboard has five round columns and a total. During a round it shows only who has
entered (✓, live); numbers, totals and ranking update when the host taps Next (or Finish). Next
and Finish wait until everyone has a score for every round so far, no round has two zeros, and
the round being closed has its zero (`canCloseRound`; closed rounds aren't judged again, so
removing a player can't lock the game). Finish is checked once more on fresh data before any
stats are written (`canFinishGame`). A double tap moves on one round only, and if a just-saved
score hasn't reached the server within 5 s, Next says there's no connection instead of moving on
later by itself.

## Online games

- Start probes the backend: anonymous sign-in plus a server read of `room/probe`, 3 s timeout.
  Reachable means a `FirestoreGameRepository` room; unreachable means a local game.
- Identity is the Firebase Anonymous Auth uid. The host creates `room/CODE` (5 characters, no
  0/O/1/I, 6 h expiry) and is seated first. Others seat themselves. Names are unique per room,
  ignoring case and extra spaces.
- Late joiners fill in the rounds they missed. The host can add guests (players without a phone,
  scored by the host), fix any score, and remove any seat but their own.
- Creating a room or taking a seat times out after 10 s: a host falls back to a local game, a
  joiner is told the game is unreachable. Reloading `/room/CODE` finds the seat again.
- Play again: the host creates the next room, links the finished room to it (`nextRoomCode`),
  and seats everyone there as they were, guests included. Other phones move over when their seat
  appears; "Join the next game" is the fallback. It never falls back to a local game.

## Offline host mode

- `LocalGameRepository` keeps the game in localStorage (`card-scorekeeper:local-game`). No room
  code, no remote players: the host enters every score. A reload resumes the game.
- Used when the probe fails, when online setup throws (bad config, sign-in refused), or with
  "Vain tällä puhelimella" on. No photo count.
- **Reconnect = push final result only.** Finish queues the host's own stats row in
  `card-scorekeeper:pending-results`, uploaded under the device's anonymous uid on launch, when
  the browser comes back online, and when Tilastot opens. No mid-game merge. A result the rules
  reject for good moves to `card-scorekeeper:pending-results-failed`, so it can't block later
  ones. Tilastot says how many games wait, and offers the refused ones a retry or a delete.
- Firebase loads with a dynamic `import()` on first use, so it never delays the first screen.

## Data model (Firestore)

| Path | Fields | Written by |
|---|---|---|
| `room/{code}` | code, status, currentRound, hostUid, createdAt, expiresAt, previousRoomCode?, nextRoomCode? | host |
| `room/{code}/players/{id}` | name, ownerUid, deviceUuid, totalScore, joinOrder, isGuest? | the player (own seat); the host (guests, carried seats, removal) |
| `room/{code}/names/{key}` | ownerUid, playerId? (guests) | same batch as its seat |
| `room/{code}/roundScores/{id}_{round}` | playerId, ownerUid, round, points | the player (own); the host (anyone) |
| `game_result/{gameId}` | gameId, finishedAt, totalRounds, participantUids | host at Finish, or the reconnect flush |
| `game_player/{gameId}_{id}` | gameId, participantUids, deviceUuid, displayName, finalScore, placement, bestRound, worstRound | same |
| `leaderboard/{gameId}_{id}` | displayName, finalScore, worstRound, finishedAt | same, right after each row |

- `{id}` is the anonymous uid, or `guest-<uuid>` for a guest; stats rows carry it as `deviceUuid`.
  A name key is `n_` plus the lowercased name. `gameId` is the room code online, a UUID locally.
- Standings and stats come from `roundScores`. A seat's `totalScore` is created as 0 and no longer
  written (older clients may still update it); nothing reads it.
- Rooms are never deleted: online stats are keyed by room code, so a TTL needs a per-game id first.

## Security

`firebase/firestore.rules` is the security boundary, tested in `tests/rules`. Every rule needs a
signed-in user. A room can be fetched by code but never listed. Seats and scores are readable
only by room members. A player writes only their own seat and scores; the host may write any
score in their room, create guest and carried seats, and remove seats. Values are bounded: round
1–5, points a multiple of 5 up to 1000, rounds advance one at a time, and a finished room never
reopens. Stats rows are append-only and readable only by the game's participants. Online, only
the host writes them, and only for seated players; a local result can only name its writer. A
highscore entry must copy its stats row exactly. Accepted limit: a host can enter made-up scores
in their own game.

## Stats & history

- Keyed by the anonymous uid. Clearing browser storage or changing device starts a new identity,
  and a shared phone shares one.
- Tilastot (this device) shows games played, wins and win rate, best and worst final score, best and worst round,
  average final score, and head-to-head records per opponent. Every query filters
  `participantUids array-contains uid`. The identity caveats sit behind an ⓘ by its heading.
- A local game uploads only the host's row, since the other players on that phone have no
  identity. A guest keeps its id only through Play again, so its stats don't carry over to other
  games.
- Ennätykset, its own page: public top-10 lists. Pelit: best game, worst game, biggest round
  from `leaderboard`. Pelaajat: most wins, best win rate, best average, most games from
  `player_totals` (rate and average need 5 games). Only finished online games with at least two
  players (guests included) count, published after the room is finished; local games count in
  Tilastot only. An entry that can't be written is left out and never blocks the game.

## Photo count

- **Entering a round's score.** Typing the number always works. In an online room a player can
  photograph their own cards instead: the phone downscales the picture and posts it with its
  Firebase ID token to `/api/count`. The sheet lists each detected card and the total; the player
  fixes either and confirms. Nothing is saved without that.
- **Extraction shape:** `{ cards: [{ rank, suit, value }], total }`. The server recomputes every
  value and the total with `rules.ts` and never trusts the model's sum. Over 60 cards is refused.
- **Protecting your Gemini free tier.** `api/count.ts` checks the request shape and size (1.5 MB)
  first, then verifies the ID token with `jose`. The room must exist, be neither finished nor
  expired, and have the caller seated. Limits: 30 calls per 15 min per room and 300 per hour
  overall, in memory per instance. Gemini (`GEMINI_MODEL`, default `gemini-3.8-flash`) gets 15 s.
  The key has no billing and lives in its own Google Cloud project, so the worst case is "quota
  used up today". Server env: `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `GEMINI_MODEL`.

## Hosting

- Vercel serves the SPA and `/api` (`vercel.json`: SPA rewrite, security headers with the CSP in
  Report-Only, 30 s function limit). The public `VITE_FIREBASE_*` config is baked in at build.
- Feature PRs squash-merge into `develop`, which deploys to test-rommi.vercel.app on
  `card-scorekeeper-staging` (PR previews use it too). A release fast-forwards `main`, which
  deploys to rommi.vercel.app on `card-scorekeeper-prod-1673f`. Both are free Spark projects;
  rules go out with `firebase deploy --only firestore,auth --project <id>`.
- PWA: installable as "Rommi", with a precached shell so a local game opens offline. A new
  version waits for Päivitä; the app checks every 30 min and when it returns to the screen.

## Testing

- **Unit** (`pnpm test:run`): Vitest and happy-dom, next to the code. Strict test-first for
  `lib/game`, behaviour tests for stores and components, Firebase mocked at the boundary.
- **API** (`pnpm test:api`, `test:api-load`): the function with fakes, then loaded as Vercel does.
- **Rules** (`pnpm test:rules`) and **integration** (`pnpm test:integration`, the real browser
  SDK) on the emulator.
- **E2E** (`pnpm test:e2e`): Playwright against the emulators (a production build in CI),
  Chromium and Firefox, two-device flows included. **Visual** (`pnpm test:visual`): the key screens in dark
  and light, compared in Playwright's Linux image through Docker.
- CI runs them all (`verify`, `rules`, `e2e` and `visual` jobs), with no retries.
