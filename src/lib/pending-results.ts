/**
 * The local queue of finished-game results a `LocalGameRepository` (offline, no network) cannot
 * upload itself, plus the logic that flushes it once the app is back online (see
 * docs/PLAN.md "Reconnect = push final result only" and docs/DECISIONS.md's offline entries).
 *
 * Kept pure/injectable per the tdd skill: `flushPendingResults` takes a `PendingResultWriter` the
 * caller injects, so this file never imports Firestore/Firebase and is fully unit-testable with a
 * mock writer and an in-memory storage fake — the real writer (Firestore + auth) is wired up at
 * the app-bootstrap edge (see `firestore-stats.ts`), not here.
 */
import type { GamePlayer, GameResult } from './types'
import type { KeyValueStorage } from './key-value-storage'

export const PENDING_RESULTS_STORAGE_KEY = 'card-scorekeeper:pending-results'

/** One finished game's permanent record, queued together — always written as a unit. */
export interface PendingResult {
  result: GameResult
  players: GamePlayer[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isGameResult(value: unknown): value is GameResult {
  return (
    isRecord(value) &&
    typeof value.gameId === 'string' &&
    typeof value.finishedAt === 'string' &&
    typeof value.totalRounds === 'number' &&
    typeof value.winnerUuid === 'string'
  )
}

function isGamePlayer(value: unknown): value is GamePlayer {
  return (
    isRecord(value) &&
    typeof value.gameId === 'string' &&
    typeof value.deviceUuid === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.finalScore === 'number' &&
    typeof value.placement === 'number' &&
    typeof value.bestRound === 'number' &&
    typeof value.worstRound === 'number'
  )
}

function isPendingResult(value: unknown): value is PendingResult {
  return (
    isRecord(value) &&
    isGameResult(value.result) &&
    Array.isArray(value.players) &&
    value.players.every(isGamePlayer)
  )
}

/** Guards the localStorage boundary the same way `local-repository.ts`'s `readStoredGame` does: a
 * schema change, partial write, or foreign data under our key must never crash — it just looks
 * like an empty queue. Malformed entries mixed into an otherwise-valid array are dropped rather
 * than discarding the whole queue. */
export function readPendingResults(storage: KeyValueStorage): PendingResult[] {
  const raw = storage.getItem(PENDING_RESULTS_STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isPendingResult) : []
  } catch {
    return []
  }
}

function writePendingResults(storage: KeyValueStorage, entries: PendingResult[]): void {
  // Best-effort, same as LocalGameRepository's own persistence: a storage failure (e.g. iOS
  // Safari private mode) must not throw out of a caller that's mid-way through finishing a game
  // or flushing a queue.
  try {
    storage.setItem(PENDING_RESULTS_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Swallowed deliberately — see comment above.
  }
}

/** Queues one finished game's permanent record for later upload. */
export function appendPendingResult(storage: KeyValueStorage, entry: PendingResult): void {
  writePendingResults(storage, [...readPendingResults(storage), entry])
}

/** Uploads one queued `PendingResult`. Implemented by the real Firestore writer in
 * `firestore-stats.ts` in production, and by a mock in tests (see the tdd skill's "mock at the
 * boundary" — this file never talks to Firebase directly). */
export interface PendingResultWriter {
  write(entry: PendingResult): Promise<void>
}

export interface FlushPendingResultsSummary {
  flushed: number
  remaining: number
}

/**
 * Uploads every queued pending result through `writer`, in queue order. Stops at the first
 * failure — a write rejecting almost always means connectivity dropped again, so trying the rest
 * of the queue immediately would just fail the same way — and persists whatever's left (the
 * failed entry and everything after it) back to the queue for the next flush attempt. An
 * already-empty queue never calls `writer` at all.
 */
export async function flushPendingResults(
  storage: KeyValueStorage,
  writer: PendingResultWriter,
): Promise<FlushPendingResultsSummary> {
  const pending = readPendingResults(storage)

  let flushedCount = 0
  for (const entry of pending) {
    try {
      await writer.write(entry)
      flushedCount += 1
    } catch {
      break
    }
  }

  const remaining = pending.slice(flushedCount)
  writePendingResults(storage, remaining)
  return { flushed: flushedCount, remaining: remaining.length }
}
