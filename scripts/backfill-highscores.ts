/**
 * One-time backfill of the public lists (leaderboard + player_totals) for games finished before
 * they existed. See docs/RELEASE.md for when to run it. The Admin SDK bypasses the rules, so the
 * planner (src/lib/game/highscore-backfill.ts) applies their conditions itself.
 *
 *   pnpm backfill:highscores --project card-scorekeeper-staging            # dry run: prints the plan
 *   pnpm backfill:highscores --project card-scorekeeper-staging --write    # applies it
 *
 * Credentials: Application Default Credentials (`gcloud auth application-default login`, or
 * GOOGLE_APPLICATION_CREDENTIALS pointing at a key file kept outside the repo).
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { planHighscoreBackfill, type BackfillGame } from '../src/lib/game/highscore-backfill'
import type { GamePlayer, GameStatus } from '../src/lib/game/types'

/** Firestore allows 500 writes in a batch. */
const BATCH_SIZE = 400

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function readGames(db: Firestore): Promise<BackfillGame[]> {
  const [results, players] = await Promise.all([
    db.collection('game_result').get(),
    db.collection('game_player').get(),
  ])
  const rowsByGame = new Map<string, GamePlayer[]>()
  for (const doc of players.docs) {
    const row = doc.data() as GamePlayer
    rowsByGame.set(row.gameId, [...(rowsByGame.get(row.gameId) ?? []), row])
  }
  return Promise.all(
    results.docs.map(async (doc) => {
      const result = doc.data() as { finishedAt: string; participantUids: string[] }
      const room = await db.doc(`room/${doc.id}`).get()
      return {
        gameId: doc.id,
        finishedAt: result.finishedAt,
        participantUids: result.participantUids,
        roomStatus: room.exists ? ((room.data()?.status as GameStatus | undefined) ?? null) : null,
        rows: rowsByGame.get(doc.id) ?? [],
      }
    }),
  )
}

async function main(): Promise<void> {
  const projectId = argValue('--project')
  if (!projectId) throw new Error('Name the project: --project <firebase project id>')
  const shouldWrite = process.argv.includes('--write')

  initializeApp({ credential: applicationDefault(), projectId })
  const db = getFirestore()

  const [games, leaderboard] = await Promise.all([
    readGames(db),
    db.collection('leaderboard').select().get(),
  ])
  const plan = planHighscoreBackfill(games, new Set(leaderboard.docs.map((doc) => doc.id)))

  console.log(`${projectId}: ${games.length} games read, ${leaderboard.size} entries exist`)
  console.log(`would create ${plan.entries.length} entries and write ${plan.totals.length} totals`)
  for (const entry of plan.entries.slice(0, 10)) console.log('  entry', entry.id, entry.data)
  for (const totals of plan.totals.slice(0, 10)) console.log('  totals', totals.uid, totals.data)
  if (!shouldWrite) {
    console.log('dry run: nothing written (add --write to apply)')
    return
  }

  const writes = [
    ...plan.entries.map((entry) => ({ path: `leaderboard/${entry.id}`, data: entry.data })),
    ...plan.totals.map((totals) => ({ path: `player_totals/${totals.uid}`, data: totals.data })),
  ]
  for (let start = 0; start < writes.length; start += BATCH_SIZE) {
    const batch = db.batch()
    for (const { path, data } of writes.slice(start, start + BATCH_SIZE)) {
      batch.set(db.doc(path), data)
    }
    await batch.commit()
  }
  console.log(`wrote ${writes.length} documents`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
