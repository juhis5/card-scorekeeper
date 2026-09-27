/**
 * Writes the permanent stats records (`game_result` + `game_player`, see docs/PLAN.md "Stats &
 * history") to Firestore. Shared by two call sites that both need exactly this shape:
 * `FirestoreGameRepository.finishGame` (an online game finishing normally) and the reconnect
 * flush wiring (`pending-results.ts`'s `flushPendingResults`, for a `LocalGameRepository` game
 * finished offline and only now reaching a connection) — see docs/DECISIONS.md's "Reconnect =
 * push final result only".
 *
 * Sequential, not batched — `game_result` is created (and confirmed to exist) before any
 * `game_player` doc is written, mirroring `FirestoreGameRepository.createGame`'s room-then-player
 * write order. This isn't just style: `firestore.rules`' `game_player` create rule checks a
 * matching `game_result` already `exists()`, and a `get()` inside a rule does not see a sibling
 * write from the same batch/transaction — so the two must be genuinely sequential writes, not one
 * atomic batch.
 *
 * Idempotent per document (`getDoc` before `setDoc`, skipping a doc that's already there) — not
 * just for tidiness. The reconnect flush (`pending-results.ts`) retries a whole `PendingResult` on
 * its NEXT launch after any failure, including a *partial* one: `Promise.all` over `game_player`
 * writes rejects as soon as one of them fails, but any others that already resolved are already
 * committed in Firestore. Firestore's append-only `game_result`/`game_player` rules deny `update`,
 * so blindly re-`setDoc`-ing a doc a prior attempt already wrote would turn one transient failure
 * into a permanent one — the retry itself would be denied forever, silently blocking every later
 * offline game from ever syncing. Checking existence first makes every write here safe to retry
 * any number of times.
 */
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore'
import type { GamePlayer, GameResult } from './types'

async function ensureGameResultWritten(
  db: Firestore,
  result: GameResult,
  participantUids: string[],
): Promise<void> {
  const ref = doc(db, `game_result/${result.gameId}`)
  const existing = await getDoc(ref)
  if (existing.exists()) return
  await setDoc(ref, {
    gameId: result.gameId,
    finishedAt: result.finishedAt,
    totalRounds: result.totalRounds,
    participantUids,
  })
}

async function ensureGamePlayerWritten(
  db: Firestore,
  player: GamePlayer,
  participantUids: string[],
): Promise<void> {
  const ref = doc(db, `game_player/${player.gameId}_${player.deviceUuid}`)
  const existing = await getDoc(ref)
  if (existing.exists()) return
  await setDoc(ref, {
    gameId: player.gameId,
    participantUids,
    deviceUuid: player.deviceUuid,
    displayName: player.displayName,
    finalScore: player.finalScore,
    placement: player.placement,
    bestRound: player.bestRound,
    worstRound: player.worstRound,
  })
}

/** Writes one finished game's permanent records: the `game_result` doc, then every player's
 * `game_player` row (in parallel with each other — they don't depend on one another, only on the
 * already-committed `game_result`). Safe to call repeatedly for the same result (see doc
 * comment above) — already-written docs are left untouched. */
export async function writeGameResult(
  db: Firestore,
  result: GameResult,
  players: GamePlayer[],
): Promise<void> {
  // Every doc names the game's players (their auth uids, which is what `deviceUuid` holds on
  // these rows), so firestore.rules can show a result only to the people who played it.
  const participantUids = players.map((player) => player.deviceUuid)
  await ensureGameResultWritten(db, result, participantUids)
  await Promise.all(players.map((player) => ensureGamePlayerWritten(db, player, participantUids)))
}
