/** The reads behind Tilastot and Ennätykset. Loaded lazily by their stores, so an offline host
 * never downloads Firebase for them. */
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore'
import { probeBackendReachable } from '../platform/connectivity'
import type { GamePlayer, GameResult } from '../game/types'
import { checkBackendReachable, ensureSignedIn, getDb, getFirebaseAuth } from './firebase'

/** Firestore's `in` operator compares against at most 30 values per query. */
const IN_QUERY_CHUNK_SIZE = 30

export interface Connection {
  db: Firestore
  uid: string
}

/** Signed in once the server is known to answer; null when it doesn't. */
export async function connectIfReachable(): Promise<Connection | null> {
  const db = getDb()
  const reachable = await probeBackendReachable({
    checkBackend: () => checkBackendReachable(getFirebaseAuth(), db),
  })
  if (!reachable) return null
  return { db, uid: await ensureSignedIn() }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export interface PlayedGames {
  /** Every row of every game this player was in, their own included. */
  rows: GamePlayer[]
  finishedAtByGameId: Map<string, string>
}

/**
 * Every query filters on participantUids: the rules only let a player list rows of games they
 * played, and a query must prove that to be allowed.
 */
export async function readPlayedGames({ db, uid }: Connection): Promise<PlayedGames> {
  const asParticipant = where('participantUids', 'array-contains', uid)
  const ownSnapshot = await getDocs(
    query(collection(db, 'game_player'), where('deviceUuid', '==', uid), asParticipant),
  )
  const ownRows = ownSnapshot.docs.map((snapshotDoc) => snapshotDoc.data() as GamePlayer)
  if (ownRows.length === 0) return { rows: [], finishedAtByGameId: new Map() }

  const gameIdChunks = chunk([...new Set(ownRows.map((row) => row.gameId))], IN_QUERY_CHUNK_SIZE)

  // Every row of those games gives the opponents; the results give their finish times. Results
  // by participant, not `documentId() in`: production refuses that with this filter, though the
  // emulator allows it.
  const [playerSnapshots, resultSnapshot] = await Promise.all([
    Promise.all(
      gameIdChunks.map((ids) =>
        getDocs(query(collection(db, 'game_player'), where('gameId', 'in', ids), asParticipant)),
      ),
    ),
    getDocs(query(collection(db, 'game_result'), asParticipant)),
  ])

  const rowsByDocId = new Map<string, GamePlayer>()
  for (const snapshot of playerSnapshots) {
    for (const snapshotDoc of snapshot.docs) {
      rowsByDocId.set(snapshotDoc.id, snapshotDoc.data() as GamePlayer)
    }
  }

  const finishedAtByGameId = new Map<string, string>()
  for (const snapshotDoc of resultSnapshot.docs) {
    finishedAtByGameId.set(snapshotDoc.id, (snapshotDoc.data() as GameResult).finishedAt)
  }

  return { rows: [...rowsByDocId.values()], finishedAtByGameId }
}

export interface TopQuery {
  collection: 'leaderboard' | 'player_totals'
  field: string
  direction: 'asc' | 'desc'
  /** Win rate and average rank only players with enough games. */
  qualifiedOnly?: boolean
}

export interface TopDoc {
  id: string
  data: DocumentData
}

function topQuery(db: Firestore, list: TopQuery, count: number) {
  return query(
    collection(db, list.collection),
    ...(list.qualifiedOnly ? [where('qualified', '==', true)] : []),
    orderBy(list.field, list.direction),
    limit(count),
  )
}

/** One public list, sorted, at most `count` long (the rules allow ten). */
export async function readTop(db: Firestore, list: TopQuery, count: number): Promise<TopDoc[]> {
  const snapshot = await getDocs(topQuery(db, list, count))
  return snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, data: snapshotDoc.data() }))
}

/** The same list, live: `onChange` hears it now and after every change. */
export function watchTop(
  db: Firestore,
  list: TopQuery,
  count: number,
  onChange: (docs: TopDoc[]) => void,
): Unsubscribe {
  return onSnapshot(
    topQuery(db, list, count),
    (snapshot) =>
      onChange(
        snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, data: snapshotDoc.data() })),
      ),
    // An extra on the finish screen: a refused or broken listener just shows nothing.
    () => undefined,
  )
}
