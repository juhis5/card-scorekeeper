/** Finished local games waiting for upload, and the flush that uploads them once online. The
 * writer is injected (see reconnect-flush.ts), so nothing here imports Firebase. */
import type { GamePlayer, GameResult } from '../game/types'
import type { KeyValueStorage } from './key-value-storage'
import { isPermanentWriteError } from './write-errors'

export const PENDING_RESULTS_STORAGE_KEY = 'card-scorekeeper:pending-results'
/** Results Firestore rejected for good (e.g. a value its rules refuse). Kept, not deleted, so the
 * record isn't lost, but never retried: one of these must not block every later game's upload. */
export const FAILED_RESULTS_STORAGE_KEY = 'card-scorekeeper:pending-results-failed'

/** One finished game's records, always written as a unit. */
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

/** Bad data under our key reads as an empty queue, never a crash. Malformed entries are dropped
 * one by one, not the whole queue. */
export function readPendingResults(storage: KeyValueStorage): PendingResult[] {
  return readResults(storage, PENDING_RESULTS_STORAGE_KEY)
}

function readResults(storage: KeyValueStorage, key: string): PendingResult[] {
  try {
    // Blocked storage throws on read, too: that means nothing queued, not a crash.
    const raw = storage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isPendingResult) : []
  } catch {
    return []
  }
}

function writeResults(storage: KeyValueStorage, key: string, entries: PendingResult[]): void {
  try {
    storage.setItem(key, JSON.stringify(entries))
  } catch {
    // Best-effort (Safari private mode): must not throw mid-finish or mid-flush.
  }
}

export function appendPendingResult(storage: KeyValueStorage, entry: PendingResult): void {
  writeResults(storage, PENDING_RESULTS_STORAGE_KEY, [...readPendingResults(storage), entry])
}

/** Re-reads the queue rather than writing back an old snapshot, so a game queued while a write
 * was in flight is never overwritten. */
function removePendingResult(storage: KeyValueStorage, gameId: string): void {
  const remaining = readPendingResults(storage).filter((entry) => entry.result.gameId !== gameId)
  writeResults(storage, PENDING_RESULTS_STORAGE_KEY, remaining)
}

function moveToFailedResults(storage: KeyValueStorage, entry: PendingResult): void {
  const failed = readResults(storage, FAILED_RESULTS_STORAGE_KEY)
  writeResults(storage, FAILED_RESULTS_STORAGE_KEY, [...failed, entry])
  removePendingResult(storage, entry.result.gameId)
}

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
 * Uploads in queue order. A transient failure stops the flush, since the rest would fail the same
 * way. A permanent one moves that entry to the failed list and carries on, so one rejected game
 * can't block every later one.
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
