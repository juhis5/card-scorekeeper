/**
 * An invite from start to finish against the emulators and the real rules, no mocks: the host
 * invites a claimed name, plays and finishes, and the invited player counts the game as theirs.
 * Proves the batches the rules pair up (getAfter/existsAfter both ways) and that nobody's stats
 * then show the player twice.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  linkWithCredential,
  signInAnonymously,
  type Auth,
} from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { FirestoreGameRepository } from '@/lib/data/firestore-repository'
import { publishHighscores } from '@/lib/data/firestore-stats'
import {
  answerInvite,
  countInvite,
  readInvite,
  watchInvites,
  type Invite,
} from '@/lib/data/invites'
import { claimName } from '@/lib/data/name-claims'
import { readPlayedGames } from '@/lib/data/stats-reads'
import { withoutReplacedGuests } from '@/lib/game/stats'
import type { ContractRoundNumber, GameState } from '@/lib/game/types'

const FIRESTORE_EMULATOR_PORT = 8280
const AUTH_EMULATOR_PORT = 9299

let deviceCount = 0
const apps: FirebaseApp[] = []

function makeDevice(): { auth: Auth; db: Firestore } {
  deviceCount += 1
  const app = initializeApp(
    { projectId: 'demo-card-scorekeeper', apiKey: 'fake-api-key' },
    `invite-device-${deviceCount}`,
  )
  apps.push(app)
  const auth = getAuth(app)
  const db = getFirestore(app)
  connectAuthEmulator(auth, `http://localhost:${AUTH_EMULATOR_PORT}`, { disableWarnings: true })
  connectFirestoreEmulator(db, 'localhost', FIRESTORE_EMULATOR_PORT)
  return { auth, db }
}

/** Signed in with a fresh Google account, holding a fresh claimed name. */
async function claimOwner(): Promise<{ db: Firestore; uid: string; name: string }> {
  const device = makeDevice()
  const { user } = await signInAnonymously(device.auth)
  const sub = `google-${crypto.randomUUID()}`
  await linkWithCredential(
    user,
    GoogleAuthProvider.credential(JSON.stringify({ sub, email: `${sub}@example.com` })),
  )
  const name = `Juho ${crypto.randomUUID().slice(0, 8)}`
  await claimName(device.db, user.uid, name)
  return { db: device.db, uid: user.uid, name }
}

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

function firstInvites(db: Firestore, uid: string): Promise<Invite[]> {
  return new Promise((resolve, reject) => {
    const unsubscribe = watchInvites(
      db,
      uid,
      (invites) => {
        unsubscribe()
        resolve(invites)
      },
      reject,
    )
  })
}

/** Five rounds and Finish, with one 0 each round as the rules require. */
async function playAndFinish(repo: FirestoreGameRepository, hostId: string, guestId: string) {
  const rounds: ContractRoundNumber[] = [1, 2, 3, 4, 5]
  for (const round of rounds) {
    await repo.setRoundScore({ playerId: hostId, round, points: round === 1 ? 25 : 0 })
    await repo.setRoundScore({ playerId: guestId, round, points: round === 1 ? 0 : 5 })
    if (round < 5) await repo.advanceRound(round)
  }
  await repo.finishGame()
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => deleteApp(app)))
})

describe('an invite, end-to-end against the emulators', () => {
  it('counts a finished game for the invited player, once, on everyone’s stats', async () => {
    const juho = await claimOwner()
    const host = makeDevice()
    const hostRepo = new FirestoreGameRepository({ db: host.db, auth: host.auth })
    const created = await hostRepo.createGame({
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Host',
    })
    const guestId = await hostRepo.addGuest({ name: juho.name })
    const seated = await waitForState(hostRepo, (state) => state.players.length === 2)
    expect(seated.players.find((player) => player.id === guestId)?.invitedUid).toBe(juho.uid)

    const [pending] = await firstInvites(juho.db, juho.uid)
    expect(pending).toMatchObject({ gameId: created.roomCode, name: juho.name, hostName: 'Host' })
    if (!pending) throw new Error('expected an invite')
    await answerInvite(juho.db, pending.id, 'accepted')

    const rounds: ContractRoundNumber[] = [1, 2, 3, 4, 5]
    for (const round of rounds) {
      // One player goes out (0) every round, as the rules require: Juho in round 1, then the host.
      await hostRepo.setRoundScore({
        playerId: created.hostPlayerId,
        round,
        points: round === 1 ? 25 : 0,
      })
      await hostRepo.setRoundScore({ playerId: guestId, round, points: round === 1 ? 0 : 5 })
      if (round < 5) await hostRepo.advanceRound(round)
    }
    await hostRepo.finishGame()
    hostRepo.leave()

    const accepted = await readInvite(juho.db, pending.id)
    if (!accepted) throw new Error('expected the invite')
    const counted = await countInvite(juho.db, juho.uid, accepted)
    if (!counted) throw new Error('expected the game to count')
    expect(counted.row).toMatchObject({ deviceUuid: juho.uid, finalScore: 20, placement: 1 })
    await expect(publishHighscores(juho.db, counted.result, [counted.row])).resolves.toEqual([])
    expect((await readInvite(juho.db, pending.id))?.status).toBe('counted')

    const juhoGames = await readPlayedGames({ db: juho.db, uid: juho.uid })
    expect(
      withoutReplacedGuests(juhoGames.rows)
        .map((row) => row.deviceUuid)
        .sort(),
    ).toEqual([created.hostPlayerId, juho.uid].sort())

    const hostGames = await readPlayedGames({ db: host.db, uid: created.hostPlayerId })
    const opponents = withoutReplacedGuests(hostGames.rows).filter(
      (row) => row.deviceUuid !== created.hostPlayerId,
    )
    expect(opponents.map((row) => row.deviceUuid)).toEqual([juho.uid])
  })

  it('lets the invited player decline, leaving the seat a guest', async () => {
    const juho = await claimOwner()
    const host = makeDevice()
    const hostRepo = new FirestoreGameRepository({ db: host.db, auth: host.auth })
    await hostRepo.createGame({ hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })
    await hostRepo.addGuest({ name: juho.name })

    const [pending] = await firstInvites(juho.db, juho.uid)
    if (!pending) throw new Error('expected an invite')
    await answerInvite(juho.db, pending.id, 'declined')

    await expect(firstInvites(juho.db, juho.uid)).resolves.toEqual([])
  })
  it('invites the player again when the host plays again, so several can wait at once', async () => {
    const juho = await claimOwner()
    const host = makeDevice()
    const firstRepo = new FirestoreGameRepository({ db: host.db, auth: host.auth })
    const first = await firstRepo.createGame({
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Host',
    })
    const guestId = await firstRepo.addGuest({ name: juho.name })
    await playAndFinish(firstRepo, first.hostPlayerId, guestId)

    const nextRepo = new FirestoreGameRepository({ db: host.db, auth: host.auth })
    const next = await nextRepo.createNextGame(
      { hostDeviceUuid: 'device-host', hostDisplayName: 'Host' },
      first.gameId,
    )
    await nextRepo.carrySeats()

    const invites = await firstInvites(juho.db, juho.uid)
    expect(invites.map((invite) => invite.gameId).sort()).toEqual(
      [first.gameId, next.gameId].sort(),
    )
  })
})
