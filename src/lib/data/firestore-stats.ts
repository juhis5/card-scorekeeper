/** A finished game's permanent records, written by the online finishGame and by the reconnect
 * flush for games finished offline, and the online game's highscore entries. */
import { doc, getDoc, runTransaction, setDoc, type Firestore } from 'firebase/firestore'
import { nextPlayerTotals, type PlayerTotals } from '../game/stats'
import type { GamePlayer, GameResult } from '../game/types'
import { reportHandledError } from '../platform/error-reporting'
import { isPermanentWriteError } from './write-errors'

/** The stored result wins over a new one: a retried Finish carries a new `finishedAt`, and the
 * rules check that entries and rows match the stored one. */
async function ensureGameResultWritten(
  db: Firestore,
  result: GameResult,
  participantUids: string[],
): Promise<GameResult> {
  const ref = doc(db, `game_result/${result.gameId}`)
  const existing = await getDoc(ref)
  if (existing.exists()) {
    const stored = existing.data() as GameResult
    return { gameId: result.gameId, finishedAt: stored.finishedAt, totalRounds: stored.totalRounds }
  }
  await setDoc(ref, {
    gameId: result.gameId,
    finishedAt: result.finishedAt,
    totalRounds: result.totalRounds,
    participantUids,
  })
  return result
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

/** Repeats a stats row on the public highscores and adds it to the player's running totals, in
 * one transaction: the rules count a row in the totals only in the write that publishes its entry,
 * and a transaction retries when two games finish with the same player at once. */
async function publishEntry(db: Firestore, result: GameResult, player: GamePlayer): Promise<void> {
  const entryId = `${player.gameId}_${player.deviceUuid}`
  const entryRef = doc(db, `leaderboard/${entryId}`)
  const totalsRef = doc(db, `player_totals/${player.deviceUuid}`)
  await runTransaction(db, async (transaction) => {
    const [entry, totals] = await Promise.all([
      transaction.get(entryRef),
      transaction.get(totalsRef),
    ])
    if (entry.exists()) return
    transaction.set(entryRef, {
      displayName: player.displayName,
      finalScore: player.finalScore,
      worstRound: player.worstRound,
      finishedAt: result.finishedAt,
    })
    const previous = totals.exists() ? (totals.data() as PlayerTotals) : null
    transaction.set(totalsRef, nextPlayerTotals(previous, player, entryId))
  })
}

/** Safe to retry: each write skips a doc that exists. The rules forbid updates, so re-writing a doc
 * that a partly failed attempt already wrote would be denied forever and block every later sync. */
export async function writeGameResult(
  db: Firestore,
  result: GameResult,
  players: GamePlayer[],
): Promise<GameResult> {
  // The players' auth uids (what `deviceUuid` holds here), so firestore.rules shows a result
  // only to the people who played it.
  const participantUids = players.map((player) => player.deviceUuid)
  // Before the player rows, not batched: their rule checks this doc exists(), and a rule doesn't
  // see a sibling write in the same batch.
  const stored = await ensureGameResultWritten(db, result, participantUids)
  await Promise.all(players.map((player) => ensureGamePlayerWritten(db, player, participantUids)))
  return stored
}

/** An online game's rows on the public lists. Only after its room is finished: the rules count an
 * online game with two or more players only once it's over, and never a local one. Highscores are
 * an extra, so a failed entry never fails the game: it's reported, and returned so a transient
 * failure can be retried later (each entry is written once, so a retry never counts twice). */
export async function publishHighscores(
  db: Firestore,
  result: GameResult,
  players: GamePlayer[],
): Promise<GamePlayer[]> {
  const failed: GamePlayer[] = []
  await Promise.all(
    players.map((player) =>
      publishEntry(db, result, player).catch((error: unknown) => {
        reportHandledError(error, 'publish-highscores')
        if (!isPermanentWriteError(error)) failed.push(player)
      }),
    ),
  )
  return failed
}
