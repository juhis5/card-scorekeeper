---
name: firestore-realtime
description: How to wire Firebase/Firestore live-sync, the room-code join flow, device-UUID identity, security rules, and the persistent-stats layer for this scorekeeper. Read before touching src/lib/firebase.ts, any store that subscribes to Firestore, firestore.rules, or the stats code.
---

# Firestore realtime + rooms + identity + stats

Firebase modular SDK (v9+). Firestore is the **source of truth** for live game state; the client subscribes and renders. No polling, no manual refresh.

## Firebase init

```ts
// src/lib/firebase.ts
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  // ...
})
export const db = getFirestore(app)
```

The Firebase web config is **public by design** — shipping it in `VITE_*` is fine. Security is enforced by **Firestore rules**, never by hiding config. (The Gemini key is different — that never touches the client; see `vercel-gemini`.)

## Live subscription — inside a Pinia store, cleaned up

```ts
import { onSnapshot, doc, collection, query, where } from 'firebase/firestore'

let unsub: (() => void) | null = null
function subscribe(code: string) {
  leave()
  const q = query(collection(db, 'player'), where('room_code', '==', code))
  unsub = onSnapshot(q, snap => {
    players.value = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Player)
  })
}
function leave() { unsub?.(); unsub = null }
```

- One `onSnapshot` per logical view; store the unsubscribe and call it on `leave()` / `onScopeDispose`. Leaked listeners burn free-tier reads.
- Writes: `setDoc`/`updateDoc`/`addDoc`. Use a `writeBatch` when updating a round for several players at once.
- Prefer few documents with `onSnapshot` over many tiny reads — free tier is billed in operation counts.

## Data model

Mirror docs/PLAN.md. Ephemeral game state (`room`, `player`, `round_score`) and the permanent stats layer (`player_profile`, `game_result`, `game_player`) are **two separate layers**:

- Rooms are transient and carry `created_at` / `expires_at`. A leaked room code stops working when the room expires.
- On **game finish**, write the permanent records (`game_result` + one `game_player` per player, keyed by `device_uuid`). Stats and head-to-head are computed from these — head-to-head by comparing `placement` between two UUIDs across shared `game_id`s (no separate table).
- The 5 contracts and card values are a **code constant** (`src/lib/rules.ts`), not DB data.

## Identity — device UUID + display name

```ts
// generated once, persisted in localStorage (via the identity Pinia store + persistedstate)
let id = localStorage.getItem('device_uuid')
if (!id) { id = crypto.randomUUID(); localStorage.setItem('device_uuid', id) }
```

- The UUID is the stable identity; the name is an editable label.
- Document the known failure modes in the UI where stats show: new device / cleared storage = new identity; shared device = merged stats; no cross-device view. These are accepted trade-offs (no login), not bugs to fix.

## Security rules (firestore.rules) — enforce, don't just hide in UI

Permissions from the plan must live in rules, not only the client:

- Any player may create/edit **their own** `round_score` / `player` row; the **host** may edit anyone's in their room. The host also creates **guest seats** (players without a phone, id `guest-<uuid>`, `isGuest: true`) and enters their scores; see DECISIONS "guest seats".
- Reads scoped to a room a client is in.
- Reject writes to expired rooms.
- Permanent stats records are append-only on game finish; not editable afterward.

Model host/player identity with the `device_uuid` (or a Firebase Anonymous Auth uid if you add it) and check it in the rule conditions. Test rules with the emulator before deploy. **Firestore is the enforcement boundary** — the mobile UI hiding a button is not security.

## Photo card-count

That feature calls Gemini through the serverless function, gated by room code + session token — see the `vercel-gemini` skill. The function uses the **Admin SDK** (server-side) to verify the room; clients never use Admin credentials.

## Offline host mode (required)

The host must be able to run a full game with the backend unreachable. Because `lib/rules.ts` is pure (no network), offline is a data-layer swap, not a rewrite.

- **Repository seam.** The room/game store depends on a `GameRepository` interface, never on Firestore directly:
  ```ts
  interface GameRepository {
    createGame(config: GameConfig): Promise<GameId>
    subscribe(onChange: (state: GameState) => void): Unsubscribe
    setRoundScore(playerId: string, round: number, points: number): Promise<void>
    finishGame(): Promise<GameResult>
  }
  ```
  Two implementations, identical domain + UI above them:
  - `FirestoreGameRepository` — online, live multi-device sync via `onSnapshot` + writes.
  - `LocalGameRepository` — in-memory state persisted to localStorage; no network. `subscribe` re-emits local state on each mutation.
- **Mode chosen on "start game".** Probe backend reachability with `checkBackendReachable` (sign in, then `getDocFromServer` on `room/probe`: a cached anonymous session alone proves nothing on Wi-Fi without internet). Creating a room or taking a seat times out after 10 s and the host falls back to a local game. After a reload, `RoomView` resumes `/room/CODE` via `findSeat()` (host status from the room's `hostUid`). Reachable → Firestore repo, generate a room code, players join. Unreachable → Local repo: **single-device host game** — the host enters everyone's scores, no room code, no remote join (the confirmed scope).
- **Transient drops during an online game** are separate: enable Firestore offline persistence (`persistentLocalCache` in the modern SDK) so a synced game survives brief disconnects — cached reads, queued writes flushed on reconnect. This is "connection blipped mid-game", distinct from "never connected".
- **Photo card-count is online-only** (needs Gemini). Detect offline and hide/disable the camera shortcut; manual entry (always available) is the offline path — make that obvious.
- **Reconnect = push final result only (confirmed).** An offline game stays local its whole life. When connectivity returns, upload only the finished `game_result` + per-player `game_player` rows (keyed by device UUID) so stats/head-to-head stay complete. No live-room promotion, no mid-game merge, no conflict resolution. If still offline at game end, queue the result in localStorage and flush on the next launch that has a connection.
- **What offline can't do:** remote players joining, live cross-device sync, photo-count. Everything else — rounds, contracts, scoring, standings, winner — works fully offline because the rules are pure.

## Free-tier hygiene

- Unsubscribe listeners. Batch writes. Don't store per-keystroke updates.
- Let expired rooms sit or clean them periodically — tiny rows, well within Spark plan.
