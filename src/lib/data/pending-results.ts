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
import type { GamePlayer, GameResult } from '../game/types'
import type { KeyValueStorage } from './key-value-storage'
import { isPermanentWriteError } from './write-errors'

export const PENDING_RESULTS_STORAGE_KEY = 'card-scorekeeper:pending-results'
/** Results Firestore rejected for good (e.g. a value its rules refuse). Kept, not deleted, so the
 * record isn't lost, but never retried: one of these must not block every later game's upload. */
export const FAILED_RESULTS_STORAGE_KEY = 'card-scorekeeper:pending-results-failed'

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
    typeof value.totalRounds === 'number'
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
  return readResults(storage, PENDING_RESULTS_STORAGE_KEY)
}

function readResults(storage: KeyValueStorage, key: string): PendingResult[] {
  const raw = storage.getItem(key)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isPendingResult) : []
  } catch {
    return []
  }
}

function writeResults(storage: KeyValueStorage, key: string, entries: PendingResult[]): void {
  // Best-effort, same as LocalGameRepository's own persistence: a storage failure (e.g. iOS
  // Safari private mode) must not throw out of a caller that's mid-way through finishing a game
  // or flushing a queue.
  try {
    storage.setItem(key, JSON.stringify(entries))
  } catch {
    // Swallowed deliberately — see comment above.
  }
}

/** Queues one finished game's permanent record for later upload. */
export function appendPendingResult(storage: KeyValueStorage, entry: PendingResult): void {
  writeResults(storage, PENDING_RESULTS_STORAGE_KEY, [...readPendingResults(storage), entry])
}

/** Re-reads the queue rather than writing back an old snapshot, so a game queued while a write
 * was in flight (a long offline session in an installed PWA) is never overwritten. */
function removePendingResult(storage: KeyValueStorage, gameId: string): void {
  const remaining = readPendingResults(storage).filter((entry) => entry.result.gameId !== gameId)
  writeResults(storage, PENDING_RESULTS_STORAGE_KEY, remaining)
}

function moveToFailedResults(storage: KeyValueStorage, entry: PendingResult): void {
  const failed = readResults(storage, FAILED_RESULTS_STORAGE_KEY)
  writeResults(storage, FAILED_RESULTS_STORAGE_KEY, [...failed, entry])
  removePendingResult(storage, entry.result.gameId)
}

/** Uploads one queued `PendingResult`. Implemented by the real Firestore writer in
 * `firestore-stats.ts` in production, and by a mock in tests (see the tdd skill's "mock at the
 * boundary" — this file never talks to Firebase directly). */
export interface PendingResultWriter {
  write(entry: PendingResult): Promise<void>
}

export interface FlushPendingResultsSummary {
  flushed: number
  /** Moved to the failed list because Firestore rejected them for good. */
  failed: number
  remaining: number
}

/**
 * Uploads every queued pending result through `writer`, in queue order.
 * - A transient failure (offline, timeout, unknown) stops the flush: the rest would fail the same
 *   way, so the failed entry and everything after it stay queued for the next attempt.
 * - A permanent failure (`isPermanentWriteError`) moves that entry to the failed list and the
 *   flush continues, so one rejected game can't block every later one.
 * An already-empty queue never calls `writer` at all.
 */
export async function flushPendingResults(
  storage: KeyValueStorage,
  writer: PendingResultWriter,
): Promise<FlushPendingResultsSummary> {
  let flushed = 0
  let failed = 0

  for (const entry of readPendingResults(storage)) {
    try {
      await writer.write(entry)
    } catch (error) {
      if (!isPermanentWriteError(error)) break
      moveToFailedResults(storage, entry)
      failed += 1
      continue
    }
    removePendingResult(storage, entry.result.gameId)
    flushed += 1
  }

  return { flushed, failed, remaining: readPendingResults(storage).length }
}
