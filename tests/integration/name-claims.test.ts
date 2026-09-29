/**
 * Claiming a name against the emulators and the real rules, no mocks: proves the token a real
 * Google link produces is what the rules accept, and that an anonymous player is refused.
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
import { claimName, readNameClaim, readOwnClaim } from '@/lib/data/name-claims'
import { NameClaimedError } from '@/lib/game/player-names'

const FIRESTORE_EMULATOR_PORT = 8280
const AUTH_EMULATOR_PORT = 9299

let deviceCount = 0
const apps: FirebaseApp[] = []

function makeDevice(): { auth: Auth; db: Firestore } {
  deviceCount += 1
  const app = initializeApp(
    { projectId: 'demo-card-scorekeeper', apiKey: 'fake-api-key' },
    `claim-device-${deviceCount}`,
  )
  apps.push(app)
  const auth = getAuth(app)
  const db = getFirestore(app)
  connectAuthEmulator(auth, `http://localhost:${AUTH_EMULATOR_PORT}`, { disableWarnings: true })
  connectFirestoreEmulator(db, 'localhost', FIRESTORE_EMULATOR_PORT)
  return { auth, db }
}

/** Anonymous, then linked to a fresh Google account, as the menu does it. */
async function googlePlayer(): Promise<{ auth: Auth; db: Firestore; uid: string }> {
  const device = makeDevice()
  const { user } = await signInAnonymously(device.auth)
  const sub = `google-${crypto.randomUUID()}`
  await linkWithCredential(
    user,
    GoogleAuthProvider.credential(JSON.stringify({ sub, email: `${sub}@example.com` })),
  )
  return { ...device, uid: user.uid }
}

/** A name no earlier run has claimed: the emulator keeps data between runs. */
function freshName(): string {
  return `Juho ${crypto.randomUUID().slice(0, 8)}`
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => deleteApp(app)))
})

describe('claimed names, end-to-end against the emulators', () => {
  it('lets a Google player claim a name, once, and tells the next one it is taken', async () => {
    const name = freshName()
    const juho = await googlePlayer()

    expect(await claimName(juho.db, juho.uid, name)).toBe('claimed')
    expect(await readOwnClaim(juho.db, juho.uid)).toBe(name)

    const other = await googlePlayer()
    expect(await claimName(other.db, other.uid, name.toUpperCase())).toBe('taken')
    expect(await readNameClaim(other.db, name)).toEqual({ name, ownerUid: juho.uid })
  })

  it('refuses an anonymous player', async () => {
    const { auth, db } = makeDevice()
    const { user } = await signInAnonymously(auth)

    await expect(claimName(db, user.uid, freshName())).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })

  it('refuses a second name for the same account', async () => {
    const juho = await googlePlayer()
    await claimName(juho.db, juho.uid, freshName())

    await expect(claimName(juho.db, juho.uid, freshName())).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })

  it("seats only the owner of a claimed name, though a host's guest may use it", async () => {
    const name = freshName()
    const owner = await googlePlayer()
    await claimName(owner.db, owner.uid, name)

    const host = makeDevice()
    const hostRepo = new FirestoreGameRepository({ db: host.db, auth: host.auth })
    await expect(
      hostRepo.createGame({ hostDeviceUuid: 'device-host', hostDisplayName: name }),
    ).rejects.toBeInstanceOf(NameClaimedError)
    const { roomCode } = await hostRepo.createGame({
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Host',
    })
    if (!roomCode) throw new Error('expected an online room code')

    const copycat = makeDevice()
    const copycatRepo = new FirestoreGameRepository({ ...copycat, roomCode })
    await expect(
      copycatRepo.addPlayer({ name: name.toUpperCase(), deviceUuid: 'device-c' }),
    ).rejects.toBeInstanceOf(NameClaimedError)

    const ownerRepo = new FirestoreGameRepository({ db: owner.db, auth: owner.auth, roomCode })
    await expect(ownerRepo.addPlayer({ name, deviceUuid: 'device-o' })).resolves.toBe(owner.uid)

    // Removing the owner frees the name in the room; the host's guest may then take it.
    await hostRepo.removePlayer(owner.uid)
    await expect(hostRepo.addGuest({ name })).resolves.toMatch(/^guest-/)
  })
})
