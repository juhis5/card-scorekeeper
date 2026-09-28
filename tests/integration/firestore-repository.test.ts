/**
 * `FirestoreGameRepository` against the emulator and the real rules, no mocks. Proves what a fake
 * can't, such as seating yourself before subscribing (the reverse hits a permission-denied that
 * never heals). Uses the SDK's browser build; vitest.config.ts says why.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth } from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  type Firestore,
} from 'firebase/firestore'
import { FirestoreGameRepository } from '@/lib/data/firestore-repository'
import { NameTakenError } from '@/lib/game/player-names'
import type { ContractRoundNumber, GameState } from '@/lib/game/types'

const FIRESTORE_EMULATOR_PORT = 8280
const AUTH_EMULATOR_PORT = 9299

interface Device {
  app: FirebaseApp
  db: Firestore
  auth: Auth
}

let deviceCount = 0
const apps: FirebaseApp[] = []

/** One device: its own Firebase app and anonymous session, connected to the emulators. */
function makeDevice(): Device {
  deviceCount += 1
  const app = initializeApp(
    { projectId: 'demo-card-scorekeeper', apiKey: 'fake-api-key' },
    `device-${deviceCount}`,
  )
  apps.push(app)
  const db = getFirestore(app)
  const auth = getAuth(app)
  connectFirestoreEmulator(db, 'localhost', FIRESTORE_EMULATOR_PORT)
  connectAuthEmulator(auth, `http://localhost:${AUTH_EMULATOR_PORT}`, { disableWarnings: true })
  return { app, db, auth }
}

/** The first emitted state matching `predicate`, then unsubscribes. No sleeping or polling. */
function waitForState(
  repo: FirestoreGameRepository,
  predicate: (state: GameState) => boolean,
): Promise<GameState> {
  return new Promise((resolve) => {
    const unsubscribe = repo.subscribe((state) => {
      if (!predicate(state)) return
      unsubscribe()
      resolve(state)
    })
  })
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => deleteApp(app)))
})

describe('FirestoreGameRepository, end-to-end against the emulator', () => {
  it('lets a host create a game, a joiner join and score, and both see it live', async () => {
    const host = makeDevice()
    const hostRepo = new FirestoreGameRepository({ db: host.db, auth: host.auth })

    const created = await hostRepo.createGame({
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Host',
    })
    expect(created.roomCode).not.toBeNull()

    const hostSeesTwoPlayers = waitForState(hostRepo, (state) => state.players.length === 2)

    const joiner = makeDevice()
    const joinerRepo = new FirestoreGameRepository({
      db: joiner.db,
      auth: joiner.auth,
      roomCode: created.roomCode ?? undefined,
    })
    // Seat first, then subscribe (as join() does), so the first snapshot passes the read gate.
    const aliceUid = await joinerRepo.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    expect(joiner.auth.currentUser?.uid).toBe(aliceUid)

    const joinerSeesSelf = waitForState(joinerRepo, (state) =>
      state.players.some((player) => player.id === aliceUid),
    )

    const hostState = await hostSeesTwoPlayers
    expect(hostState.players.map((player) => player.name)).toEqual(['Host', 'Alice'])

    const joinerState = await joinerSeesSelf
    expect(joinerState.players.some((player) => player.id === aliceUid)).toBe(true)

    // The total and the round score arrive through separate listeners: wait for both.
    const hostSeesScore = waitForState(
      hostRepo,
      (state) =>
        state.players.find((player) => player.id === aliceUid)?.totalScore === 15 &&
        state.roundScores.some((score) => score.playerId === aliceUid && score.round === 1),
    )
    await joinerRepo.setRoundScore({ playerId: aliceUid, round: 1, points: 15 })
    const scoredState = await hostSeesScore
    expect(scoredState.players.find((player) => player.id === aliceUid)?.totalScore).toBe(15)
    expect(scoredState.roundScores).toContainEqual({ playerId: aliceUid, round: 1, points: 15 })

    hostRepo.leave()
    joinerRepo.leave()
  })

  // The real finishGame() writes against the real rules: the unit test checks only the calls, and
  // the rules test only hand-written fixtures.
  it('writes game_result + a game_player row per player on finishGame, readable back', async () => {
    const host = makeDevice()
    const hostRepo = new FirestoreGameRepository({ db: host.db, auth: host.auth })
    const created = await hostRepo.createGame({
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Host',
    })
    const roomCode = created.roomCode
    if (!roomCode) throw new Error('expected an online room code')

    const joiner = makeDevice()
    const joinerRepo = new FirestoreGameRepository({ db: joiner.db, auth: joiner.auth, roomCode })
    const aliceUid = await joinerRepo.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    await waitForState(hostRepo, (state) => state.players.length === 2)

    const rounds: ContractRoundNumber[] = [1, 2, 3, 4, 5]
    for (const round of rounds) {
      await hostRepo.setRoundScore({ playerId: created.hostPlayerId, round, points: 50 })
      await joinerRepo.setRoundScore({ playerId: aliceUid, round, points: 10 })
      if (round < 5) await hostRepo.advanceRound()
    }

    const result = await hostRepo.finishGame()
    expect(result.gameId).toBe(roomCode)

    const gameResultDoc = await getDoc(doc(host.db, `game_result/${roomCode}`))
    expect(gameResultDoc.exists()).toBe(true)
    expect(gameResultDoc.data()).toMatchObject({
      gameId: roomCode,
      totalRounds: 5,
      participantUids: expect.arrayContaining([created.hostPlayerId, aliceUid]),
    })

    // A stats row's deviceUuid is the auth uid, not the device_uuid passed above: the rules can
    // check room membership only against the uid players/ is keyed by.
    const hostPlayerDoc = await getDoc(
      doc(host.db, `game_player/${roomCode}_${created.hostPlayerId}`),
    )
    expect(hostPlayerDoc.data()).toMatchObject({
      deviceUuid: created.hostPlayerId,
      finalScore: 250,
      placement: 2,
      bestRound: 50,
      worstRound: 50,
    })

    const alicePlayerDoc = await getDoc(doc(host.db, `game_player/${roomCode}_${aliceUid}`))
    expect(alicePlayerDoc.data()).toMatchObject({
      deviceUuid: aliceUid,
      finalScore: 50,
      placement: 1,
      bestRound: 10,
      worstRound: 10,
    })

    // The highscores are public: someone who never played here reads them too.
    const stranger = makeDevice()
    await signInAnonymously(stranger.auth)
    const entry = await getDoc(doc(stranger.db, `leaderboard/${roomCode}_${aliceUid}`))
    expect(entry.data()).toEqual({
      displayName: 'Alice',
      finalScore: 50,
      worstRound: 10,
      finishedAt: result.finishedAt,
    })
    const board = await getDocs(
      query(collection(stranger.db, 'leaderboard'), orderBy('finalScore'), limit(10)),
    )
    expect(board.size).toBeGreaterThan(0)
    const totals = await getDoc(doc(stranger.db, `player_totals/${aliceUid}`))
    expect(totals.data()).toMatchObject({
      displayName: 'Alice',
      gamesPlayed: 1,
      wins: 1,
      scoreSum: 50,
      winRate: 1,
      averageScore: 50,
      qualified: false,
    })

    hostRepo.leave()
    joinerRepo.leave()
  })

  // The unique-name records only work if the SDK's batch, the real rules and the repository's
  // error mapping agree, which no mocked test can show.
  it('refuses a name already in the room, and frees it once the host removes that player', async () => {
    const host = makeDevice()
    const hostRepo = new FirestoreGameRepository({ db: host.db, auth: host.auth })
    const created = await hostRepo.createGame({
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Juho',
    })
    const roomCode = created.roomCode
    if (!roomCode) throw new Error('expected an online room code')

    const alice = makeDevice()
    const aliceRepo = new FirestoreGameRepository({ db: alice.db, auth: alice.auth, roomCode })
    const aliceUid = await aliceRepo.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })

    const copycat = makeDevice()
    const copycatRepo = new FirestoreGameRepository({
      db: copycat.db,
      auth: copycat.auth,
      roomCode,
    })
    const error = await copycatRepo
      .addPlayer({ name: ' juho ', deviceUuid: 'device-c' })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NameTakenError)

    await waitForState(hostRepo, (state) => state.players.length === 2)
    await hostRepo.removePlayer(aliceUid)
    const bobUid = await copycatRepo.addPlayer({ name: 'ALICE', deviceUuid: 'device-c' })
    const final = await waitForState(hostRepo, (state) =>
      state.players.some((player) => player.id === bobUid),
    )
    expect(final.players.map((player) => player.name).sort()).toEqual(['ALICE', 'Juho'])

    hostRepo.leave()
    aliceRepo.leave()
    copycatRepo.leave()
  })

  it('seats a guest the host scores for, whose name a joiner is told belongs to a guest', async () => {
    const host = makeDevice()
    const hostRepo = new FirestoreGameRepository({ db: host.db, auth: host.auth })
    const created = await hostRepo.createGame({
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Juho',
    })
    const roomCode = created.roomCode
    if (!roomCode) throw new Error('expected an online room code')

    const guestId = await hostRepo.addGuest({ name: 'Mummo' })
    await hostRepo.setRoundScore({ playerId: guestId, round: 1, points: 15 })

    const alice = makeDevice()
    const aliceRepo = new FirestoreGameRepository({ db: alice.db, auth: alice.auth, roomCode })
    const error = await aliceRepo
      .addPlayer({ name: 'MUMMO', deviceUuid: 'device-a' })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NameTakenError)
    expect((error as NameTakenError).isGuestSeat).toBe(true)

    await aliceRepo.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    const seen = await waitForState(
      aliceRepo,
      (state) => state.players.length === 3 && state.roundScores.length === 1,
    )
    expect(seen.players.find((player) => player.id === guestId)).toEqual({
      id: guestId,
      name: 'Mummo',
      totalScore: 15,
      isGuest: true,
    })
    expect(seen.roundScores).toContainEqual({ playerId: guestId, round: 1, points: 15 })

    hostRepo.leave()
    aliceRepo.leave()
  })

  // Play again brings everyone along only if the order (create, link, carry) meets the real
  // rules' checks on the finished room, which no mocked test can show.
  it('brings everyone from the finished room into the next one, and the joiner sees its seat there', async () => {
    const host = makeDevice()
    const hostRepo = new FirestoreGameRepository({ db: host.db, auth: host.auth })
    const created = await hostRepo.createGame({
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Juho',
    })
    const roomCode = created.roomCode
    if (!roomCode) throw new Error('expected an online room code')
    const alice = makeDevice()
    const aliceRepo = new FirestoreGameRepository({ db: alice.db, auth: alice.auth, roomCode })
    const aliceUid = await aliceRepo.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    const guestId = await hostRepo.addGuest({ name: 'Mummo' })
    const rounds: ContractRoundNumber[] = [1, 2, 3, 4, 5]
    for (const round of rounds) {
      await hostRepo.setRoundScore({ playerId: created.hostPlayerId, round, points: 50 })
      await hostRepo.setRoundScore({ playerId: aliceUid, round, points: 10 })
      await hostRepo.setRoundScore({ playerId: guestId, round, points: 20 })
      if (round < 5) await hostRepo.advanceRound()
    }
    await hostRepo.finishGame()
    const aliceSeesHerSeat = waitForState(aliceRepo, (state) => state.hasSeatInNextRoom === true)

    const nextRepo = new FirestoreGameRepository({ db: host.db, auth: host.auth })
    const next = await nextRepo.createNextGame(
      { hostDeviceUuid: 'device-host', hostDisplayName: 'Juho' },
      roomCode,
    )
    const nextCode = next.roomCode
    if (!nextCode) throw new Error('expected an online room code')
    await hostRepo.linkNextRoom(nextCode)
    await nextRepo.carrySeats()

    const seen = await aliceSeesHerSeat
    expect(seen.nextRoomCode).toBe(nextCode)
    const aliceNextRepo = new FirestoreGameRepository({
      db: alice.db,
      auth: alice.auth,
      roomCode: nextCode,
    })
    await expect(aliceNextRepo.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })).resolves.toBe(
      aliceUid,
    )
    const nextState = await waitForState(aliceNextRepo, (state) => state.players.length === 3)
    expect(nextState.players).toEqual([
      { id: next.hostPlayerId, name: 'Juho', totalScore: 0 },
      { id: aliceUid, name: 'Alice', totalScore: 0 },
      { id: guestId, name: 'Mummo', totalScore: 0, isGuest: true },
    ])

    hostRepo.leave()
    aliceRepo.leave()
    nextRepo.leave()
    aliceNextRepo.leave()
  })
})
