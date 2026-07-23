# Card Game Scorekeeper — Project Plan

A web app for keeping score in a card game. A host starts a game; players join with a
room code and everyone sees scores update live.

> **Mobile-first.** This is designed for phones and will almost never be used on a PC.
> Every UI decision assumes a phone held one-handed at a card table: large tap targets,
> single-column layouts, thumb-reachable primary actions, and the camera (for photo
> counting) as a first-class input. Desktop should still work in a browser, but it is
> not a design target — nothing is optimised for wide screens, mouse, or keyboard.

## Decisions locked

Finalised during planning. **This section wins** over the "Recommended/Alternative/Hosting" framing below; `CLAUDE.md` + `.claude/skills/` are the source of truth for *how*.

- **Stack:** Vite + Vue 3.5 + TypeScript (strict) + Pinia + **pnpm**.
- **Realtime backend:** **Firebase / Firestore** (Spark free tier). **Supabase is NOT used** — kept below only as the alternative that was weighed.
- **Frontend hosting:** **Vercel** (Firestore is host-agnostic; consistency with schedule-app). The optional photo-count function is a **Vercel** `/api` function — not Firebase Cloud Functions.
- **UI:** Tailwind v4 + shadcn-vue (Reka UI); **dark-default** theme (light via toggle). Vue Router; vue-i18n (fi/en, device-default — no hardcoded strings).
- **Target platforms:** must work on **Android (Chrome), iOS (Safari), and desktop browsers** — mobile-first, not mobile-only. Responsive ~360px→desktop (no overflow on wide screens); camera (photo-count) → file-upload fallback on desktop.
- **Offline host mode:** required (see the section above) — `GameRepository` seam, single-device local game, reconnect pushes final result only.
- **Vision (optional):** Gemini Flash, free-tier key, room + session-token gated; image downscaled client-side.
- **Testing/quality:** Vitest + @vue/test-utils + Playwright + Firebase emulator (rules), pragmatic TDD; PWA shell (makes offline load); Prettier + ESLint; Conventional Commits + git hooks + CI.
- **Identity / stats / rules:** per the Confirmed decisions section (device UUID, five contracts, low-total-wins).

## What it does

1. **Host** starts a new game → app generates a short room code.
2. **Players** open the app, enter the code and a name, and join the room.
3. Host (or players) update scores as rounds are played.
4. Everyone in the room sees changes **in real time**, no refresh.

## The defining requirement: real-time

The scores are tiny — kilobytes. Storage size is a non-issue on any free tier. The
thing that actually shapes the tech choice is **live sync**: when one person updates a
score, others should see it immediately. That rules out plain databases with no
real-time layer (Neon, Turso) unless you hand-roll websockets or polling.

## Offline host mode (required)

The app must be playable by the **host on a single device with the backend unreachable**. Because the scoring rules are pure (no network), offline play is a swap of the data layer, not a rewrite of the game:

- **On "start game", probe connectivity.** Reachable → normal synced room (players join by code, live sync). Unreachable → **local host game**: the host runs the scoreboard on their phone and enters everyone's scores; no room code, no remote players.
- A **repository interface** abstracts the data layer so the domain and UI don't change between modes (local vs Firestore) — see the `firestore-realtime` skill.
- **Firestore offline persistence** covers brief disconnects during an online game (queued writes, cached reads) — separate from "never connected".
- **Photo card-count is online-only** (needs Gemini); offline falls back to manual entry, which is always available.
- **Reconnect = push final result only.** Offline games stay local; when back online, only the finished `game_result` + `game_player` rows upload so stats stay complete. No mid-game merge or conflict resolution.
- Offline cannot do: remote join, live cross-device sync, photo-count. Everything else works.

## Recommended stack: Firebase

Firebase is built for exactly this live-sync, room-based pattern and has a generous
free tier.

- **Firestore** (or Realtime Database) — clients subscribe to a room document and get
  pushed updates automatically. This is the "host updates, players see it" mechanic
  with no extra service to run.
- **Free tier (Spark plan)** — generous daily reads/writes and storage, sized well
  beyond a hobby card game with a handful of concurrent players.
- Simple client SDK; no backend server to maintain.

### One extra piece: the photo-count vision function
The optional photo-count feature (see scoring below) needs a vision model, and the API
key must stay hidden — same constraint as the schedule app. So the card game gains one
small serverless function (a **Vercel** `/api` function — see Decisions locked)
that holds the Gemini key and reads the hand photo. If you skip photo counting, you
don't need this function at all — manual scoring needs only Firebase.

### Is it really free for your use?
For a hobby scoreboard — a few players, modest reads/writes — yes, comfortably within
the free Spark plan. The free tier's ceilings are daily operation counts and storage,
which casual multiplayer use won't approach. Two honest caveats:

- **NoSQL, not SQL.** Data is documents/collections, not tables. Different mental
  model from your Oracle/SQL background, though simple for this shape of data.
- **Google infrastructure.** If EU data residency matters, Firebase has EU regions,
  but consider Supabase (EU) as the SQL alternative.
- **Tiers change.** Verify the current Firebase free-tier limits before relying on
  specific numbers — this doc is directional.

## Alternative: Supabase (considered, NOT chosen)

> **Decided: Firebase** (see *Decisions locked*). This section is kept only to record the alternative that was weighed — do not build on Supabase.

If you'd rather have SQL (rooms/players/scores as real tables) and EU data:

- Postgres **plus built-in Realtime** — subscribe to a room, get live updates. Covers
  the same need as Firebase, with SQL.
- Free tier ample for hobby use; note free-tier projects **pause after inactivity**
  (a click to wake). Minor for a game played occasionally.

**Steer:** Firebase for the smoothest real-time and simplest setup (NoSQL, Google);
Supabase if you want SQL and EU residency.

## Data model (sketch)

Small and simple:

```
room
  code          (short unique string, e.g. 4–6 chars)
  status        (waiting | playing | finished)
  current_round (1..5)
  created_at
  expires_at    (room auto-expires — limits leaked-code abuse)

player
  room_code     (which room)
  name
  total_score   (running sum, ascending = winning)
  join_order
  session_token (issued on join; sent with photo-count calls to gate the function)

round_score     (one per player per round — enables per-round history)
  room_code
  player
  round_number  (1..5)
  points        (leftover-card points that round; low is good)
```

The 5 rounds and their contracts are fixed rules, so they live in the app code (a
constant), not the database — the DB only stores which round a room is on plus the
scores. `round_score` is optional; drop it if you only want running totals, keep it to
show each round and fix mistakes. `expires_at` and `session_token` support the Gemini
protection model above.

## Design notes for the room-code pattern

- **Room code** = short unique string generated on "host starts game"; players type it
  to join. It's just a lookup key.
- **Concurrency** is where real-time earns its keep — multiple players on the same
  room. Polling (refetch every few seconds) is the simpler fallback but feels laggy
  and wastes requests; real-time is the better fit.
- **Room lifecycle** — decide when rooms expire. Hobby-fine answer: a `created_at`
  timestamp with periodic cleanup, or just let old tiny rows sit.

## Hosting the frontend

- **Decided: Vercel** (Firestore is host-agnostic, so live sync works from any host;
  keeps one deploy workflow across both apps). Firebase Hosting / Netlify were the
  other free options considered.

## Protecting your Gemini free tier

The photo-count feature calls Gemini through a serverless function. The key lives only
in that function's env var, never in the browser — but an open function URL is an open
door, so it needs a gate plus caps.

**The wrinkle vs. the schedule app:** the card game is joined by strangers via a room
code, and *any player* can snap a photo. A fixed shared passphrase (fine for a
2-person tool) doesn't fit — you can't hand a secret to people you don't know. So the
gate is the **room itself**.

### Layered protection

1. **Room-validated calls.** Every photo-count request must include a valid room code
   plus a per-session token the app issued when the player joined. The function checks
   in Firebase that the room exists and is an active game *before* calling Gemini.
   Random pokes at the URL with no valid room are rejected.
2. **Per-room rate limit.** Cap calls per room (a hand-count a few times per round is
   plenty). Stops one abusive room from draining the quota.
3. **Global rate limit.** A ceiling across all rooms as a backstop — stops someone
   spinning up many fake rooms to get around the per-room cap.
4. **Short-lived rooms.** Rooms expire after a game or a few hours, so a leaked room
   code stops working quickly. The gate is naturally temporary.
5. **Free-tier key, no billing.** Create the Gemini key with no billing attached. The
   free tier rate-limits rather than bills, so the hard ceiling is your safety net —
   worst case is "quota exhausted today," not a surprise invoice.

### Honest limits of this
This is *good enough for a hobby game*, not airtight. Someone who joined a real game
could still burn some calls. But the layered caps bound the damage (per-room + global)
and it self-heals (rooms expire, quota resets daily). For a scorekeeper played by
friends, that's the right amount — real accounts / per-user auth would be overkill for
the stakes.

### If abuse ever became real
Two escape hatches, only if needed: make photo-count fully optional (manual scoring
needs no key at all), or let the **host paste their own Gemini key** into the room so
usage runs on their quota, not yours. Not worth the friction for a friends game unless
a problem actually shows up.

## The game: Rommi (Finnish Rummy) — confirmed rules

The scorekeeper is built around this specific ruleset, not generic Rummy:

- **Scoring direction:** points count **against** cards left in your hand when someone
  goes out. Low is good.
- **Card values (cards left in hand):**
  - Number cards = face value (2–10)
  - Face cards (J, Q, K) = 10 each
  - **Ace = 15**
  - **Joker = 25**
- **Game end:** a **fixed 5-round progression** (see contracts below).
- **No bonus** for going out in one turn (a clean "rommi").
- **Winner:** **lowest total points** after all 5 rounds.

### The 5 rounds (contracts)

This is a Contract Rummy style: each round requires a specific set of melds to go
down. Terms:

- **Set of three** = at least 3 cards of the same rank (suits may differ).
- **Flush** = at least 4 sequential cards of the same suit (a run).

| Round | Required contract |
|-------|-------------------|
| 1 | Two sets of threes |
| 2 | One set of three + one flush |
| 3 | Three sets of threes |
| 4 | One flush + two sets of threes |
| 5 | Two flushes + one set of three |

The app doesn't need to validate melds (players judge that at the table) — but it
should **display the current round's contract** so everyone knows what they're
building toward, and step through rounds 1→5 automatically.

### What this means for the app

- Each round, the host enters each player's leftover-card points (or the app tallies
  from selected cards — see below). Scores accumulate across the 5 rounds.
- A running total per player, sorted ascending (leader = lowest).
- Each player enters their own round score; the host can enter or correct anyone's.
- The app shows **"Round 3 of 5 — Three sets of threes"** so everyone sees the current
  contract (reminder only, no validation), and declares the winner automatically after
  round 5 is scored.

### Entering a round's score — two ways

**1. Manual (always available).** Player or host types the leftover-card total. This
is the primary, never-fails path and is never removed.

**2. Photo count (optional shortcut).** A player snaps a picture of their own leftover
cards; a vision model reads them and suggests the total.

- **Who:** any player, for their own hand.
- **What it shows before committing:** the **list of cards it detected + the total**,
  e.g. "4♦, K♠, A♥, Joker → 4 + 10 + 15 + 25 = 54". The player then **confirms or
  edits** — the photo never silently sets a score.
- **Fallback:** manual typing stays right there; if the read looks wrong or the photo
  fails, the player just types the number.
- **Values applied:** number = face value, J/Q/K = 10, Ace = 15, Joker = 25 (the
  round rules, encoded in the prompt).

#### Accuracy notes (important)
Counting cards from a photo is harder than reading printed text — overlap, glare, and
half-hidden cards cause misreads, and a wrong count matters in a scored game. So:

- Cards laid **flat and non-overlapping** read far better than a fan.
- Treat the result as a **suggestion needing a glance**, not a trusted auto-total —
  which is why the confirm step and the card-by-card breakdown exist.
- Reuses the **same Gemini function pattern** as the schedule app (no new
  infrastructure), but adds API calls — the existing rate limit covers this.

#### Extraction shape
The vision function returns something like:
```json
{ "cards": [
    {"rank":"4","suit":"diamonds","value":4},
    {"rank":"K","suit":"spades","value":10},
    {"rank":"A","suit":"hearts","value":15},
    {"rank":"Joker","suit":null,"value":25}
  ],
  "total": 54 }
```
The app shows the list, lets the player fix any card (or the total directly), then
commits the confirmed number to `round_score`.

## Stats & history (persistent across games)

This turns the app from throwaway rooms into something with lasting player stats.
Rooms still expire; but when a game **finishes**, a permanent result is written and the
stats read from that.

### Player identity: device UUID + display name
- On first use the app generates a random **UUID stored on the device** (localStorage).
  That UUID is the stable identity; the **name is just an editable display label**.
- No login, no PIN — near-zero friction for a group each on their own phone.

**Failure modes (documented so stats aren't misleading):**
- **New device or cleared storage = new identity.** History follows the *device*, not
  the person; a new phone starts fresh.
- **Shared device = merged stats.** Two people passing one phone share a UUID and blend
  their stats. Fine if everyone's on their own device.
- **No cross-device view.** Stats on the phone won't appear on the tablet.

**Upgrade path (future, not built now):** let a device optionally claim a handle + PIN
so identity can move between devices. Noted as an option, not v1.

### Stats tracked (all confirmed)
Per player identity:
- **Wins / win rate** — games finished in 1st ÷ games played.
- **Best & worst final score** — lowest and highest final totals across games.
- **Best & worst single round** — lowest and highest one-round points.
- **Games played + averages** — count, average final score.

Plus **head-to-head records** — who beats whom, across games they shared.

### Persistence model
History is a **second layer** separate from ephemeral rooms:
- Rooms stay transient (they expire).
- On game finish, write a permanent `game_result` + one `game_player` row per player,
  keyed to device UUIDs. Stats and head-to-head are computed from these.
- Tiny, infrequent records — well within Firebase's free tier.

```
player_profile        (stable identity)
  device_uuid         (primary id, from localStorage)
  display_name        (editable label)
  last_seen

game_result           (one per finished game)
  game_id
  finished_at
  total_rounds        (5)
  winner_uuid

game_player           (one per player per finished game — powers all stats)
  game_id
  device_uuid
  display_name        (as used that game)
  final_score
  placement           (1 = winner)
  best_round          (lowest single-round points that game)
  worst_round         (highest single-round points that game)
```

Head-to-head is derived by comparing `placement` between two `device_uuid`s across
games that share a `game_id` — no separate table needed.

### Honest caveat
Stats are only as trustworthy as the identity model. With device UUIDs, someone can pad
wins by "playing" alone in a room, and shared/cleared devices muddy the numbers. Not a
reason to skip the feature — just why the caveats above are documented rather than
hidden.

## Confirmed decisions

- **Scoring permissions:** any player can enter/edit **their own** round score; the
  **host can enter/edit anyone's**. (Enforced in the function/rules, not just the UI.)
- **History:** keep **per-round scores** (`round_score` table), not just running
  totals — lets players see each round and fix mistakes.
- **Contract display:** show the current round's required melds as a **reminder only**
  — no meld tick-off or validation. Players judge melds at the table.
- **Max players per room:** not capped by anything technical; the **mobile-first**
  single-column layout should stay readable for a typical group (roughly 2–6) on a
  phone screen. Adjust if your group is larger.
- **Player identity for stats:** device UUID (localStorage) + editable display name;
  no login. Caveats documented (history follows the device, not the person).
- **Stats tracked:** wins/win rate, best & worst final score, best & worst single
  round, games played + averages, and head-to-head records.

## Notes / disclaimers

- Free-tier limits and pause/inactivity behavior vary by provider and change over
  time. Figures here are directional — check current pricing pages before committing.
- Firebase is NoSQL; if that friction matters, Supabase gives you SQL with the same
  real-time capability.
