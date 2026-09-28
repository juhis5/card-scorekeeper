/** A finished game's permanent records and highscore entries, written by the online finishGame
 * and by the reconnect flush for games finished offline. */
import { doc, getDoc, runTransaction, setDoc, type Firestore } from 'firebase/firestore'
import { nextPlayerTotals, type PlayerTotals } from '../game/stats'
import type { GamePlayer, GameResult } from '../game/types'

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

/** Repeats a stats row on the public highscores and adds it to the player's running totals, in
 * one transaction: the rules count a row in the totals only in the write that publishes its entry,
 * and a transaction retries when two games finish with the same player at once. */
async function publishHighscores(
  db: Firestore,
  result: GameResult,
  player: GamePlayer,
): Promise<void> {
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
): Promise<void> {
  // The players' auth uids (what `deviceUuid` holds here), so firestore.rules shows a result
  // only to the people who played it.
  const participantUids = players.map((player) => player.deviceUuid)
  // Before the player rows, not batched: their rule checks this doc exists(), and a rule doesn't
  // see a sibling write in the same batch.
  await ensureGameResultWritten(db, result, participantUids)
  await Promise.all(
    players.map(async (player) => {
      await ensureGamePlayerWritten(db, player, participantUids)
      // Highscores are an extra: a failed entry (say, rules without the leaderboard yet) must
      // never keep a game from finishing, so it's dropped, not retried.
      await publishHighscores(db, result, player).catch(() => undefined)
    }),
  )
}
