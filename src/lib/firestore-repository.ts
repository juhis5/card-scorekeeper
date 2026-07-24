/**
 * FirestoreGameRepository — online, room-code multiplayer GameRepository. Firestore is the
 * source of truth; this class writes to it and maps its live `onSnapshot` state back to the
 * pure `GameState` the store/UI already understand. See the firestore-realtime skill and
 * docs/DECISIONS.md's 2026-07-24 online-auth / topology / read-gate / trust-model entries,
 * which this class implements against `firestore.rules`.
 *
 * Every doc under `room/{code}` is written only by this class, using the shapes below — unlike
 * `LocalGameRepository`'s localStorage boundary (foreign/corrupted data risk), so snapshot data
 * is read back with a typed cast rather than a full runtime shape guard.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import type { Auth } from 'firebase/auth'
import { ensureSignedIn } from './firebase'
import { generateRoomCode as defaultGenerateRoomCode } from './room-code'
import { TOTAL_ROUNDS, runningTotal, winners as leadingPlayers } from './rules'
import type {
  ContractRoundNumber,
  GameResult,
  GameState,
  GameStatus,
  Player,
  RoundScore,
} from './types'
import type {
  AddPlayerInput,
  CreatedGame,
  GameConfig,
  GameRepository,
  PlayerId,
  SetRoundScoreInput,
  Unsubscribe,
} from './repository'

/** Rooms are short-lived by design (see docs/PLAN.md "Protecting your Gemini free tier") — a
 * leaked room code stops working a few hours after the game that used it. */
const ROOM_TTL_MS = 6 * 60 * 60 * 1000

/** Bounds the room-code retry loop below — collisions are astronomically rare (see room-code.ts's
 * alphabet/length); this is a backstop against an infinite loop, not an expected path. */
const MAX_CREATE_GAME_ATTEMPTS = 5

interface RoomDocData {
  code: string
  status: GameStatus
  currentRound: ContractRoundNumber
  hostUid: string
  createdAt: Timestamp
  expiresAt: Timestamp
}

interface PlayerDocData {
  name: string
  ownerUid: string
  deviceUuid: string
  totalScore: number
  joinOrder: number
}

interface RoundScoreDocData {
  playerId: string
  ownerUid: string
  round: ContractRoundNumber
  points: number
}

function toPlayer(snapshot: QueryDocumentSnapshot): Player {
  const data = snapshot.data() as PlayerDocData
  return { id: snapshot.id, name: data.name, totalScore: data.totalScore }
}

function toRoundScore(snapshot: QueryDocumentSnapshot): RoundScore {
  const data = snapshot.data() as RoundScoreDocData
  return { round: data.round, playerId: data.playerId, points: data.points }
}

/** True for the `permission-denied` FirestoreError a rejected create/update surfaces as. */
function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'permission-denied'
  )
}

export interface FirestoreGameRepositoryDeps {
  db: Firestore
  auth: Auth
  /** Room code to join an existing game. Omit to host — `createGame` mints a fresh one and
   * this repository becomes that room's host for its lifetime. */
  roomCode?: string
  /** Clock, injected for deterministic tests — epoch milliseconds. Defaults to `Date.now`. */
  now?: () => number
  /** Injected for deterministic tests. Defaults to the real `generateRoomCode`. */
  generateRoomCode?: () => string
}

export class FirestoreGameRepository implements GameRepository {
  private readonly db: Firestore
  private readonly auth: Auth
  private readonly now: () => number
  private readonly generateRoomCode: () => string
  private roomCode: string | null
  private readonly unsubscribes = new Set<Unsubscribe>()

  constructor(deps: FirestoreGameRepositoryDeps) {
    this.db = deps.db
    this.auth = deps.auth
    this.now = deps.now ?? (() => Date.now())
    this.generateRoomCode = deps.generateRoomCode ?? (() => defaultGenerateRoomCode())
    this.roomCode = deps.roomCode ?? null
  }

  async createGame(config: GameConfig): Promise<CreatedGame> {
    await ensureSignedIn(this.auth)
    const hostUid = this.requireUid()

    for (let attempt = 1; attempt <= MAX_CREATE_GAME_ATTEMPTS; attempt += 1) {
      const roomCode = this.generateRoomCode()
      const nowMs = this.now()
      try {
        await setDoc(doc(this.db, `room/${roomCode}`), {
          code: roomCode,
          status: 'waiting',
          currentRound: 1,
          hostUid,
          createdAt: Timestamp.fromMillis(nowMs),
          expiresAt: Timestamp.fromMillis(nowMs + ROOM_TTL_MS),
        })
        // Sequential, not batched: the player-create rule's roomNotExpired() reads the room
        // doc via get(), which does not see a sibling write in the same batch/transaction — so
        // the room doc must already be committed before this write is sent (see
        // docs/DECISIONS.md's trust-model entry and firestore.rules).
        await setDoc(doc(this.db, `room/${roomCode}/players/${hostUid}`), {
          name: config.hostDisplayName,
          ownerUid: hostUid,
          deviceUuid: config.hostDeviceUuid,
          totalScore: 0,
          joinOrder: 0,
        })
        this.roomCode = roomCode
        return { gameId: roomCode, roomCode }
      } catch (error) {
        // A code collision surfaces as permission-denied: an existing room at that code makes
        // this a Firestore `update` (not `create`), and only its own host may update it (see
        // firestore.rules). Mint a new code and retry rather than pre-reading for collisions
        // (which would just add a race of its own). Any other error is a real failure — rethrow.
        if (!isPermissionDenied(error) || attempt === MAX_CREATE_GAME_ATTEMPTS) throw error
      }
    }
    // Unreachable: the loop above always returns or throws on its final attempt.
    throw new Error('createGame: exhausted room-code attempts')
  }

  async addPlayer(input: AddPlayerInput): Promise<PlayerId> {
    await ensureSignedIn(this.auth)
    const uid = this.requireUid()
    const roomCode = this.requireRoomCode()
    await setDoc(doc(this.db, `room/${roomCode}/players/${uid}`), {
      name: input.name,
      ownerUid: uid,
      deviceUuid: input.deviceUuid,
      totalScore: 0,
      joinOrder: this.now(),
    })
    return uid
  }

  subscribe(onChange: (state: GameState) => void): Unsubscribe {
    const roomCode = this.requireRoomCode()

    let room: { status: GameStatus; currentRound: ContractRoundNumber } | null = null
    let players: Player[] = []
    let roundScores: RoundScore[] = []

    // Waits for the room doc's first snapshot before emitting — status/currentRound are
    // required fields on GameState, so there is nothing coherent to emit before then.
    const emit = () => {
      if (!room) return
      onChange({ status: room.status, currentRound: room.currentRound, players, roundScores })
    }

    const roomUnsub = onSnapshot(doc(this.db, `room/${roomCode}`), (snapshot) => {
      const data = snapshot.data() as RoomDocData | undefined
      if (!data) return
      room = { status: data.status, currentRound: data.currentRound }
      emit()
    })

    const playersUnsub = onSnapshot(
      query(collection(this.db, `room/${roomCode}/players`), orderBy('joinOrder')),
      (snapshot) => {
        players = snapshot.docs.map(toPlayer)
        emit()
      },
    )

    const roundScoresUnsub = onSnapshot(
      collection(this.db, `room/${roomCode}/roundScores`),
      (snapshot) => {
        roundScores = snapshot.docs.map(toRoundScore)
        emit()
      },
    )

    const unsubscribe: Unsubscribe = () => {
      roomUnsub()
      playersUnsub()
      roundScoresUnsub()
      this.unsubscribes.delete(unsubscribe)
    }
    this.unsubscribes.add(unsubscribe)
    return unsubscribe
  }

  async setRoundScore(input: SetRoundScoreInput): Promise<void> {
    await ensureSignedIn(this.auth)
    const roomCode = this.requireRoomCode()

    // A fresh read of this player's own existing scores — not the live subscription cache,
    // which may not exist yet (setRoundScore must be correct even if called before subscribe())
    // — merged with the new round, matching LocalGameRepository's "replace, don't duplicate".
    const ownScores = await getDocs(
      query(
        collection(this.db, `room/${roomCode}/roundScores`),
        where('playerId', '==', input.playerId),
      ),
    )
    const roundScores = ownScores.docs
      .map(toRoundScore)
      .filter((score) => score.round !== input.round)
    roundScores.push({ playerId: input.playerId, round: input.round, points: input.points })

    const batch = writeBatch(this.db)
    batch.set(doc(this.db, `room/${roomCode}/roundScores/${input.playerId}_${input.round}`), {
      playerId: input.playerId,
      ownerUid: input.playerId,
      round: input.round,
      points: input.points,
    })
    batch.update(doc(this.db, `room/${roomCode}/players/${input.playerId}`), {
      totalScore: runningTotal(input.playerId, roundScores),
    })
    await batch.commit()
  }

  async advanceRound(): Promise<void> {
    await ensureSignedIn(this.auth)
    const roomCode = this.requireRoomCode()
    const roomRef = doc(this.db, `room/${roomCode}`)
    const snapshot = await getDoc(roomRef)
    const data = snapshot.data() as RoomDocData | undefined
    if (!data) throw new Error(`advanceRound: room ${roomCode} not found`)
    const nextRound = Math.min(data.currentRound + 1, TOTAL_ROUNDS) as ContractRoundNumber
    await updateDoc(roomRef, { status: 'playing', currentRound: nextRound })
  }

  async finishGame(): Promise<GameResult> {
    await ensureSignedIn(this.auth)
    const roomCode = this.requireRoomCode()
    const playersSnapshot = await getDocs(collection(this.db, `room/${roomCode}/players`))
    const players = playersSnapshot.docs.map(toPlayer)

    await updateDoc(doc(this.db, `room/${roomCode}`), { status: 'finished' })

    const [leader] = leadingPlayers(players)
    const deviceUuidByPlayerId = new Map(
      playersSnapshot.docs.map((snapshot) => [
        snapshot.id,
        (snapshot.data() as PlayerDocData).deviceUuid,
      ]),
    )
    const winnerUuid = leader ? (deviceUuidByPlayerId.get(leader.player.id) ?? '') : ''

    return {
      gameId: roomCode,
      finishedAt: new Date(this.now()).toISOString(),
      totalRounds: TOTAL_ROUNDS,
      winnerUuid,
    }
  }

  leave(): void {
    this.unsubscribes.forEach((unsubscribe) => unsubscribe())
    this.unsubscribes.clear()
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid
    if (!uid) {
      throw new Error(
        'FirestoreGameRepository: not signed in — ensureSignedIn() must resolve first',
      )
    }
    return uid
  }

  private requireRoomCode(): string {
    if (!this.roomCode) {
      throw new Error(
        'FirestoreGameRepository: no room code — call createGame() to host, or construct with one to join',
      )
    }
    return this.roomCode
  }
}
