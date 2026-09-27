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
import { writeGameResult } from './firestore-stats'
import { cleanPlayerName, NameTakenError, playerNameKey } from './player-names'
import {
  generateRoomCode as defaultGenerateRoomCode,
  isValidRoomCode,
  ROOM_TTL_MS,
} from './room-code'
import { CONTRACTS, TOTAL_ROUNDS, placements as placementsFor, runningTotal } from './rules'
import { bestAndWorstRound } from './stats'
import { withTimeout } from './timeout'
import { isPermissionDenied } from './write-errors'
import type {
  ContractRoundNumber,
  GamePlayer,
  GameResult,
  GameState,
  GameStatus,
  Player,
  RoundScore,
} from './types'
import type {
  AddGuestInput,
  AddPlayerInput,
  CreatedGame,
  GameConfig,
  PlayerId,
  ReplayableGameRepository,
  ResumableGameRepository,
  RoomAvailability,
  Seat,
  SetRoundScoreInput,
  Unsubscribe,
} from './repository'

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
  nextRoomCode?: string
  /** Set on a room started with Play again: the finished room its players come from. */
  previousRoomCode?: string
}

interface PlayerDocData {
  name: string
  ownerUid: string
  deviceUuid: string
  totalScore: number
  joinOrder: number
  /** Set only on a guest seat (see addGuest). */
  isGuest?: true
}

/** A seat's record under names/: a guest's also names its seat. */
interface NameRecordData {
  ownerUid: string
  playerId?: string
}

interface RoundScoreDocData {
  playerId: string
  ownerUid: string
  round: ContractRoundNumber
  points: number
}

function toPlayer(snapshot: QueryDocumentSnapshot): Player {
  const data = snapshot.data() as PlayerDocData
  const player: Player = { id: snapshot.id, name: data.name, totalScore: data.totalScore }
  if (data.isGuest === true) player.isGuest = true
  return player
}

/** firestore.rules only accepts this shape for a guest seat's id: never a uid. */
const GUEST_ID_PREFIX = 'guest-'

function toRoundScore(snapshot: QueryDocumentSnapshot): RoundScore {
  const data = snapshot.data() as RoundScoreDocData
  return { round: data.round, playerId: data.playerId, points: data.points }
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
  /** How long creating a room or taking a seat may wait for the server. Defaults to 10 s. */
  writeTimeoutMs?: number
  /** A lowercase UUID for a guest seat's id. Injected for deterministic tests. */
  newGuestId?: () => string
}

/** Firestore writes wait for the server indefinitely while offline, so the two writes the user
 * waits on before entering a room (create, join) get a bound; the caller then falls back. */
const DEFAULT_WRITE_TIMEOUT_MS = 10_000

export class FirestoreGameRepository implements ResumableGameRepository, ReplayableGameRepository {
  private readonly db: Firestore
  private readonly auth: Auth
  private readonly now: () => number
  private readonly generateRoomCode: () => string
  private readonly writeTimeoutMs: number
  private readonly newGuestId: () => string
  private roomCode: string | null
  /** The finished room this one's players come from (Play again), once createNextGame made it. */
  private previousRoomCode: string | null = null
  private readonly unsubscribes = new Set<Unsubscribe>()

  constructor(deps: FirestoreGameRepositoryDeps) {
    this.db = deps.db
    this.auth = deps.auth
    this.now = deps.now ?? (() => Date.now())
    this.generateRoomCode = deps.generateRoomCode ?? (() => defaultGenerateRoomCode())
    this.writeTimeoutMs = deps.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS
    this.newGuestId = deps.newGuestId ?? (() => crypto.randomUUID())
    this.roomCode = deps.roomCode ?? null
  }

  createGame(config: GameConfig): Promise<CreatedGame> {
    return this.createRoom(config, {})
  }

  /** The room records the finished one, which is what lets the host seat its players here (see
   * firestore.rules' isCarriedSeat). */
  async createNextGame(config: GameConfig, previousRoomCode: string): Promise<CreatedGame> {
    const created = await this.createRoom(config, { previousRoomCode })
    this.previousRoomCode = previousRoomCode
    return created
  }

  private async createRoom(
    config: GameConfig,
    extraFields: Pick<RoomDocData, 'previousRoomCode'>,
  ): Promise<CreatedGame> {
    await ensureSignedIn(this.auth)
    const hostUid = this.requireUid()

    for (let attempt = 1; attempt <= MAX_CREATE_GAME_ATTEMPTS; attempt += 1) {
      const roomCode = this.generateRoomCode()
      const nowMs = this.now()
      try {
        await withTimeout(
          setDoc(doc(this.db, `room/${roomCode}`), {
            code: roomCode,
            status: 'waiting',
            currentRound: 1,
            hostUid,
            createdAt: Timestamp.fromMillis(nowMs),
            expiresAt: Timestamp.fromMillis(nowMs + ROOM_TTL_MS),
            ...extraFields,
          }),
          this.writeTimeoutMs,
        )
        // After the room, not batched with it: the player-create rule's roomNotExpired() reads
        // the room doc via get(), which does not see a sibling write in the same batch — so the
        // room doc must already be committed (see docs/DECISIONS.md's trust-model entry).
        await withTimeout(
          this.takeSeat(roomCode, hostUid, {
            name: cleanPlayerName(config.hostDisplayName),
            deviceUuid: config.hostDeviceUuid,
            joinOrder: 0,
          }),
          this.writeTimeoutMs,
        )
        this.roomCode = roomCode
        return { gameId: roomCode, roomCode, hostPlayerId: hostUid }
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
    // Rejoining after a reload: keep the seat. Rewriting it would change joinOrder, which the
    // rules refuse, and would reorder the player.
    if (await this.isSeated(uid)) return uid
    const name = cleanPlayerName(input.name)
    try {
      await withTimeout(
        this.takeSeat(roomCode, uid, { name, deviceUuid: input.deviceUuid, joinOrder: this.now() }),
        this.writeTimeoutMs,
      )
    } catch (error) {
      if (!isPermissionDenied(error)) throw error
      // The host of the game before seated this device meanwhile (Play again): already in.
      if (await this.isSeated(uid)) return uid
      const record = await this.nameRecord(roomCode, name)
      // Your own record is a rejoin in progress, not a clash.
      const isTaken = record !== null && (record.ownerUid !== uid || record.playerId !== undefined)
      if (isTaken) throw new NameTakenError(name, { isGuestSeat: record.playerId !== undefined })
      throw error
    }
    return uid
  }

  /** A player without a phone: a seat owned by the host, with a guest id and a name record
   * naming the seat, in one batch like takeSeat (see firestore.rules' guest branches). */
  async addGuest(input: AddGuestInput): Promise<PlayerId> {
    await ensureSignedIn(this.auth)
    const hostUid = this.requireUid()
    const roomCode = this.requireRoomCode()
    const name = cleanPlayerName(input.name)
    const guestId = `${GUEST_ID_PREFIX}${this.newGuestId()}`
    try {
      await withTimeout(
        this.seatGuest(roomCode, hostUid, guestId, { name, joinOrder: this.now() }),
        this.writeTimeoutMs,
      )
    } catch (error) {
      if (!isPermissionDenied(error)) throw error
      const record = await this.nameRecord(roomCode, name)
      if (record) throw new NameTakenError(name, { isGuestSeat: record.playerId !== undefined })
      throw error
    }
    return guestId
  }

  private seatGuest(
    roomCode: string,
    hostUid: string,
    guestId: string,
    seat: { name: string; joinOrder: number },
  ): Promise<void> {
    const batch = writeBatch(this.db)
    batch.set(doc(this.db, `room/${roomCode}/players/${guestId}`), {
      name: seat.name,
      ownerUid: hostUid,
      deviceUuid: guestId,
      totalScore: 0,
      joinOrder: seat.joinOrder,
      isGuest: true,
    } satisfies PlayerDocData)
    batch.set(doc(this.db, `room/${roomCode}/names/${playerNameKey(seat.name)}`), {
      ownerUid: hostUid,
      playerId: guestId,
    } satisfies NameRecordData)
    return batch.commit()
  }

  async carrySeats(): Promise<void> {
    await ensureSignedIn(this.auth)
    const hostUid = this.requireUid()
    const roomCode = this.requireRoomCode()
    if (!this.previousRoomCode) throw new Error('carrySeats: call createNextGame() first')
    const previousSeats = await withTimeout(
      getDocs(collection(this.db, `room/${this.previousRoomCode}/players`)),
      this.writeTimeoutMs,
    )
    // Settled, not all: a seat that can't be taken is someone the host adds again in the room,
    // and their phone still has "Join the next game".
    await Promise.allSettled(
      previousSeats.docs
        .filter((seat) => seat.id !== hostUid)
        .map((seat) =>
          withTimeout(
            this.carrySeat(roomCode, hostUid, seat.id, seat.data() as PlayerDocData),
            this.writeTimeoutMs,
          ),
        ),
    )
  }

  /** As it was in the finished room, zeroed: a guest keeps its id, so its stats stay together, and
   * everyone keeps their place in the order. */
  private carrySeat(
    roomCode: string,
    hostUid: string,
    playerId: string,
    seat: PlayerDocData,
  ): Promise<void> {
    const kept = { name: seat.name, joinOrder: seat.joinOrder }
    if (seat.isGuest === true) return this.seatGuest(roomCode, hostUid, playerId, kept)
    return this.takeSeat(roomCode, playerId, { ...kept, deviceUuid: seat.deviceUuid })
  }

  /** The seat and its name record in one batch: the rules only accept a seat together with its
   * own record under names/, and refuse a second record for the same name, which is how names
   * stay unique in a room (see lib/player-names.ts). */
  private takeSeat(
    roomCode: string,
    uid: string,
    seat: { name: string; deviceUuid: string; joinOrder: number },
  ): Promise<void> {
    const batch = writeBatch(this.db)
    batch.set(doc(this.db, `room/${roomCode}/players/${uid}`), {
      name: seat.name,
      ownerUid: uid,
      deviceUuid: seat.deviceUuid,
      totalScore: 0,
      joinOrder: seat.joinOrder,
    })
    batch.set(doc(this.db, `room/${roomCode}/names/${playerNameKey(seat.name)}`), {
      ownerUid: uid,
    })
    return batch.commit()
  }

  /** Tells "the name is taken" apart from the other reasons a seat is refused: the rules let any
   * signed-in user read one name record. */
  private async nameRecord(roomCode: string, name: string): Promise<NameRecordData | null> {
    const record = await getDoc(doc(this.db, `room/${roomCode}/names/${playerNameKey(name)}`))
    return record.exists() ? (record.data() as NameRecordData) : null
  }

  async findSeat(): Promise<Seat | null> {
    await ensureSignedIn(this.auth)
    const uid = this.requireUid()
    const roomCode = this.requireRoomCode()
    const room = await getDoc(doc(this.db, `room/${roomCode}`))
    const roomData = room.data() as RoomDocData | undefined
    if (!roomData || !(await this.isSeated(uid))) return null
    return { playerId: uid, isHost: roomData.hostUid === uid }
  }

  async roomAvailability(): Promise<RoomAvailability> {
    await ensureSignedIn(this.auth)
    const room = await getDoc(doc(this.db, `room/${this.requireRoomCode()}`))
    const data = room.data() as RoomDocData | undefined
    if (!data) return 'missing'
    if (data.expiresAt.toMillis() <= this.now()) return 'expired'
    return data.status === 'finished' ? 'finished' : 'open'
  }

  /** A refused read means "not seated", not an error: rules before the own-seat read (Play
   * again) only let members read seats. */
  private async isSeated(uid: string): Promise<boolean> {
    try {
      const seat = await getDoc(doc(this.db, `room/${this.requireRoomCode()}/players/${uid}`))
      return seat.exists()
    } catch (error) {
      if (isPermissionDenied(error)) return false
      throw error
    }
  }

  subscribe(onChange: (state: GameState) => void, onError?: (error: unknown) => void): Unsubscribe {
    const roomCode = this.requireRoomCode()
    const reportError = (error: unknown) => onError?.(error)

    let room: Pick<GameState, 'status' | 'currentRound' | 'nextRoomCode'> | null = null
    let players: Player[] = []
    let roundScores: RoundScore[] = []
    let hasSeatInNextRoom = false
    let nextSeatUnsub: Unsubscribe | null = null

    // Waits for the room doc's first snapshot before emitting — status/currentRound are
    // required fields on GameState, so there is nothing coherent to emit before then.
    const emit = () => {
      if (!room) return
      onChange({ ...room, players, roundScores, ...(hasSeatInNextRoom && { hasSeatInNextRoom }) })
    }

    // Play again: the host seats everyone in the next room right after linking to it, so this
    // device watches for its own seat there, and can move as soon as it has one.
    const watchNextSeat = (nextRoomCode: string) => {
      const uid = this.auth.currentUser?.uid
      if (nextSeatUnsub || !uid) return
      nextSeatUnsub = onSnapshot(
        doc(this.db, `room/${nextRoomCode}/players/${uid}`),
        (seat) => {
          hasSeatInNextRoom = seat.exists()
          emit()
        },
        // Not a lost game: "Join the next game" stays on screen as the way in.
        () => undefined,
      )
    }

    const roomUnsub = onSnapshot(
      doc(this.db, `room/${roomCode}`),
      (snapshot) => {
        const data = snapshot.data() as RoomDocData | undefined
        if (!data) return
        room = { status: data.status, currentRound: data.currentRound }
        // The rules check the link, but it becomes a route and a join, so it's checked here too.
        if (typeof data.nextRoomCode === 'string' && isValidRoomCode(data.nextRoomCode)) {
          room.nextRoomCode = data.nextRoomCode
          watchNextSeat(data.nextRoomCode)
        }
        emit()
      },
      reportError,
    )

    const playersUnsub = onSnapshot(
      query(collection(this.db, `room/${roomCode}/players`), orderBy('joinOrder')),
      (snapshot) => {
        players = snapshot.docs.map(toPlayer)
        emit()
      },
      reportError,
    )

    const roundScoresUnsub = onSnapshot(
      collection(this.db, `room/${roomCode}/roundScores`),
      (snapshot) => {
        roundScores = snapshot.docs.map(toRoundScore)
        emit()
      },
      reportError,
    )

    const unsubscribe: Unsubscribe = () => {
      roomUnsub()
      playersUnsub()
      roundScoresUnsub()
      nextSeatUnsub?.()
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

  async removePlayer(playerId: PlayerId): Promise<void> {
    await ensureSignedIn(this.auth)
    if (playerId === this.requireUid()) {
      throw new Error("removePlayer: the host's own seat can't be removed")
    }
    const roomCode = this.requireRoomCode()
    const seat = await getDoc(doc(this.db, `room/${roomCode}/players/${playerId}`))
    const name = (seat.data() as PlayerDocData | undefined)?.name
    // One batch: the seat, its name record (so the name is free again) and every round's score
    // doc (ids are `{playerId}_{round}`), all-or-nothing. Deleting a doc never written is a no-op.
    const batch = writeBatch(this.db)
    batch.delete(doc(this.db, `room/${roomCode}/players/${playerId}`))
    if (name) batch.delete(doc(this.db, `room/${roomCode}/names/${playerNameKey(name)}`))
    CONTRACTS.forEach(({ round }) => {
      batch.delete(doc(this.db, `room/${roomCode}/roundScores/${playerId}_${round}`))
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
    const roundScoresSnapshot = await getDocs(collection(this.db, `room/${roomCode}/roundScores`))
    const roundScores = roundScoresSnapshot.docs.map(toRoundScore)

    // Recomputed from roundScores, not the players' own writable totalScore field — same reason
    // the game store's rankedPlayers does (see docs/DECISIONS.md's trust-model entry): a
    // permanent stats row is worth getting exactly right regardless of any denormalized field.
    const rankedPlayers = players.map((player) => ({
      ...player,
      totalScore: runningTotal(player.id, roundScores),
    }))

    const result: GameResult = {
      gameId: roomCode,
      finishedAt: new Date(this.now()).toISOString(),
      totalRounds: TOTAL_ROUNDS,
    }

    const gamePlayers: GamePlayer[] = placementsFor(rankedPlayers).map(({ player, placement }) => {
      const points = roundScores
        .filter((score) => score.playerId === player.id)
        .map((score) => score.points)
      // Trusts the same "everyone scored every round" assumption the UI's Finish-button gate
      // relies on (see LocalGameRepository.finishGame's matching comment) — guarded rather than
      // left to bestAndWorstRound's empty-input throw, for the edge case of a player with no
      // recorded rounds at all.
      const { bestRound, worstRound } =
        points.length > 0 ? bestAndWorstRound(points) : { bestRound: 0, worstRound: 0 }
      return {
        gameId: roomCode,
        // The room participant's own auth uid (player.id — `room/{code}/players/{uid}` is keyed
        // by it), NOT the localStorage device_uuid on their player doc. firestore.rules can only
        // verify "this deviceUuid was a real participant in this room" via
        // exists(room/{gameId}/players/{deviceUuid}) — a check that only works if the value
        // matches how player docs are actually keyed. Using the spoofable localStorage
        // device_uuid here would let the host forge a stats row for a deviceUuid nobody ever
        // seated (see docs/DECISIONS.md's forgery-fix entry).
        deviceUuid: player.id,
        displayName: player.name,
        finalScore: player.totalScore,
        placement,
        bestRound,
        worstRound,
      }
    })

    // Stats first, then the room. Every device shows the winner the moment the room is finished,
    // and a player may open Stats right then. And a finished room refuses every write, so if the
    // stats write fails first the host can still retry Finish (writeGameResult is idempotent).
    await writeGameResult(this.db, result, gamePlayers)
    await updateDoc(doc(this.db, `room/${roomCode}`), { status: 'finished' })

    return result
  }

  /** Bounded like create and join: the host waits on it before moving to the next room. A write
   * that times out stays queued in the SDK and still lands once the connection is back. */
  async linkNextRoom(nextRoomCode: string): Promise<void> {
    await ensureSignedIn(this.auth)
    const roomRef = doc(this.db, `room/${this.requireRoomCode()}`)
    await withTimeout(updateDoc(roomRef, { nextRoomCode }), this.writeTimeoutMs)
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
