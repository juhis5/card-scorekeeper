---
name: firestore-realtime
description: How to wire Firebase/Firestore live-sync, the room-code join flow, anonymous-auth identity, security rules, and the persistent-stats layer for this scorekeeper. Read before touching src/lib/data/firebase.ts, src/lib/data/firestore-repository.ts, any store that subscribes to Firestore, firebase/firestore.rules, or the stats code.
---

# Firestore realtime + rooms + identity + stats

Firebase modular SDK (v9+). Firestore is the **source of truth** for live game state; the client subscribes and renders. No polling, no manual refresh.

## Firebase init

`src/lib/data/firebase.ts` initializes the app from `VITE_FIREBASE_*` behind lazy getters (`getDb()`, `getFirebaseAuth()`), and is itself loaded with a dynamic `import()` on first use, so ~190 KB gzip stays out of the first bundle an offline host loads (DECISIONS, "Firebase loads lazily"). `ensureSignedIn()` signs in anonymously once; `checkBackendReachable()` is the probe.

The Firebase web config is **public by design** — shipping it in `VITE_*` is fine. Security is enforced by **Firestore rules**, never by hiding config. (The Gemini key is different — that never touches the client; see `vercel-gemini`.)

## Live subscription — behind the repository, cleaned up

`FirestoreGameRepository.subscribe()` owns the `onSnapshot` listeners (room, `players`, `roundScores`); the game store calls it and keeps the unsubscribe. The shape:

```ts
import { onSnapshot, collection, query, orderBy } from 'firebase/firestore'

let unsub: (() => void) | null = null
function subscribe(code: string) {
  leave()
  const q = query(collection(db, `room/${code}/players`), orderBy('joinOrder'))
  unsub = onSnapshot(q, snap => {
    players.value = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Player)
  })
}
function leave() { unsub?.(); unsub = null }
```

- One `onSnapshot` per logical view; store the unsubscribe and call it on `leave()` / `onScopeDispose`. Leaked listeners burn free-tier reads.
- Writes: `setDoc`/`updateDoc`. A score save is one write; use a `writeBatch` only where docs must land together (a seat + its `names/{key}` record).
- Prefer few documents with `onSnapshot` over many tiny reads — free tier is billed in operation counts.

## Data model

Mirror docs/PLAN.md. Ephemeral game state (`room/{code}` with `players`, `names` and `roundScores` below it) and the permanent layer (`game_result`, `game_player`, and the public `leaderboard` + `player_totals`) are **two separate layers**:

- Rooms are transient and carry `createdAt` / `expiresAt`. A leaked room code stops working when the room expires.
- On **game finish**, write the permanent records: `game_result`, then one `game_player` per player keyed by `{gameId}_{uid}` (the anonymous auth uid, which the rules can check against the room's seats), then, for a finished online room with at least two players, each row's `leaderboard` entry and `player_totals` update (`lib/data/firestore-stats.ts`). Stats and head-to-head are computed from `game_player` rows, head-to-head by comparing `placement` between two uids across shared games (no separate table).
- The 5 contracts and card values are a **code constant** (`src/lib/game/rules.ts`), not DB data.

## Identity — anonymous auth uid + display name

- **The actor is the Firebase Anonymous Auth uid** (`request.auth.uid`, from `ensureSignedIn()`). Seats are `room/{code}/players/{uid}`, scores `roundScores/{uid}_{round}`, the room carries `hostUid`, and stats rows are keyed by the uid. The SDK keeps the anonymous session per browser, so the uid is the stable identity; the name is an editable label.
- The identity store (`src/stores/identity.ts`, persisted) also holds a local `deviceUuid`. It only gates `requiresIdentity` routes and rides along on a seat; the rules never trust it for permissions. (The `deviceUuid` *field* on `game_player` / `leaderboard` rows holds the auth uid, or a guest's id.)
- Document the known failure modes in the UI where stats show: new device / cleared storage = new identity; shared device = merged stats. Optional Google sign-in (menu) links the anonymous uid to an account (`lib/data/google-account.ts`, same uid), which fixes both for players who use it; a second device signing in switches onto the account's uid. Anonymous play stays the default.

## Security rules (firebase/firestore.rules) — enforce, don't just hide in UI

Permissions from the plan must live in rules, not only the client:

- Any player may create/edit **their own** seat (`players/{uid}`) and round scores; the **host** may edit anyone's in their room. The host also creates **guest seats** (players without a phone, id `guest-<uuid>`, `isGuest: true`) and enters their scores; see DECISIONS "guest seats".
- Reads scoped to a room a client is in.
- Reject writes to expired rooms.
- Permanent stats records are append-only on game finish; not editable afterward.

Check identity with `request.auth.uid` against the doc id, `ownerUid` or the room's `hostUid`; never trust a uuid carried in a field. Test rules with the emulator (`tests/rules/`) before deploy. **Firestore is the enforcement boundary** — the mobile UI hiding a button is not security.

## Photo card-count

That feature calls Gemini through the serverless function, gated by the caller's Firebase ID token (`Authorization: Bearer`, from `user.getIdToken()`) plus a seat in a live room — see the `vercel-gemini` skill. The function verifies the token with `jose` and reads the room with the **Admin SDK** (server-side); clients never use Admin credentials.

## Offline host mode (required)

The host must be able to run a full game with the backend unreachable. Because `lib/game/rules.ts` is pure (no network), offline is a data-layer swap, not a rewrite.

- **Repository seam.** The room/game store depends on a `GameRepository` interface, never on Firestore directly:
  ```ts
  // src/lib/data/repository.ts (abridged)
  interface GameRepository {
    createGame(config: GameConfig): Promise<CreatedGame>
    addPlayer(input: AddPlayerInput): Promise<PlayerId>
    subscribe(onChange: (state: GameState) => void, onError?: (error: unknown) => void): Unsubscribe
    setRoundScore(input: SetRoundScoreInput): Promise<void>
    advanceRound(fromRound: ContractRoundNumber): Promise<void>
    finishGame(): Promise<GameResult>
    // …addGuest, removePlayer, abandonGame, leave
  }
  ```
  Two implementations, identical domain + UI above them:
  - `FirestoreGameRepository` (`lib/data/firestore-repository.ts`) — online, live multi-device sync via `onSnapshot` + writes.
  - `LocalGameRepository` (`lib/data/local-repository.ts`) — in-memory state persisted to localStorage; no network. `subscribe` re-emits local state on each mutation.
- **Mode chosen on "start game".** Probe backend reachability with `checkBackendReachable` (sign in, then `getDocFromServer` on `room/probe`: a cached anonymous session alone proves nothing on Wi-Fi without internet). Creating a room or taking a seat times out after 10 s and the host falls back to a local game. After a reload, `RoomView` resumes `/room/CODE` via `findSeat()` (host status from the room's `hostUid`). Reachable → Firestore repo, generate a room code, players join. Unreachable → Local repo: **single-device host game** — the host enters everyone's scores, no room code, no remote join (the confirmed scope).
- **Transient drops during an online game** are separate: enable Firestore offline persistence (`persistentLocalCache` in the modern SDK) so a synced game survives brief disconnects — cached reads, queued writes flushed on reconnect. This is "connection blipped mid-game", distinct from "never connected".
- **Photo card-count is online-only** (needs Gemini). Detect offline and hide/disable the camera shortcut; manual entry (always available) is the offline path — make that obvious.
- **Reconnect = push final result only (confirmed).** An offline game stays local its whole life. When connectivity returns, upload only the finished `game_result` + the host's `game_player` row (keyed by the auth uid signed in at flush time) so stats stay complete. No live-room promotion, no mid-game merge, no conflict resolution. The result is queued in localStorage (`lib/data/pending-results.ts`) and the `result-queue` store flushes it (`lib/data/reconnect-flush.ts`) on launch, when the browser comes back online, and when Stats opens.
- **What offline can't do:** remote players joining, live cross-device sync, photo-count. Everything else — rounds, contracts, scoring, standings, winner — works fully offline because the rules are pure.

## Free-tier hygiene

- Unsubscribe listeners. Batch writes. Don't store per-keystroke updates.
- Let expired rooms sit or clean them periodically — tiny rows, well within Spark plan.
