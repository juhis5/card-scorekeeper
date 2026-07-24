/**
 * Emulator-backed integration test for `FirestoreGameRepository`, driving the real Firestore
 * client SDK against the same live emulator `pnpm test:rules` boots (see firebase.json), rules
 * fully enforced — no mocks. This is the one thing a fake-`GameRepository` unit test on
 * `stores/game.ts` cannot prove: that the join order (seat yourself, *then* subscribe) actually
 * works against real `onSnapshot` listeners. Reversing it would make the joiner's own subscribe
 * hit a real permission-denied that never self-heals, even after the join completes — see
 * `stores/game.ts`'s `join()` doc comment and docs/DECISIONS.md's read-gate entry.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore'
import { FirestoreGameRepository } from '@/lib/firestore-repository'
import type { GameState } from '@/lib/types'

const FIRESTORE_EMULATOR_PORT = 8280
const AUTH_EMULATOR_PORT = 9299

interface Device {
  app: FirebaseApp
  db: Firestore
  auth: Auth
}

let deviceCount = 0
const apps: FirebaseApp[] = []

/** True for a clean rules-evaluation response (allowed or denied) rather than a transport-level
 * failure — a `permission-denied` proves the channel and the emulator's rules engine both work,
 * every bit as much as a successful read would. */
function isRulesEvaluationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'permission-denied'
  )
}

/**
 * A freshly-booted Firestore emulator can report ready (its health check passes) slightly
 * before its gRPC Listen service has fully warmed up — opening a new channel's very first watch
 * stream in that window has been observed to intermittently fail with a spurious
 * resource-exhausted error against this SDK/emulator combination. Establishing one throwaway
 * listener first, retried on failure, gives that window a chance to pass — this waits on the
 * real operation actually resolving, not a blind sleep (see the tdd skill's flake guidance). The
 * probed path isn't covered by firestore.rules, so a healthy channel always answers
 * permission-denied — that alone proves it's warm; only a transport-ish error is worth retrying.
 */
async function warmUpListenChannel(db: Firestore): Promise<void> {
  const MAX_ATTEMPTS = 5
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const unsubscribe = onSnapshot(
          doc(db, '_warmup/probe'),
          () => {
            unsubscribe()
            resolve()
          },
          (error) => {
            unsubscribe()
            if (isRulesEvaluationError(error)) {
              resolve()
              return
            }
            reject(error)
          },
        )
      })
      return
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 300))
    }
  }
}

/** A fresh Firebase App + emulator-connected Firestore/Auth — models one physical device. Each
 * gets its own independent anonymous auth session, exactly like two phones at the same table. */
async function makeDevice(): Promise<Device> {
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
  await warmUpListenChannel(db)
  return { app, db, auth }
}

/** Resolves with the first emitted state matching `predicate`, then unsubscribes — event-driven
 * (no sleep/poll): `onSnapshot` pushes new states as they arrive on its own. */
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
    const host = await makeDevice()
    const hostRepo = new FirestoreGameRepository({ db: host.db, auth: host.auth })

    const created = await hostRepo.createGame({
      hostDeviceUuid: 'device-host',
      hostDisplayName: 'Host',
    })
    expect(created.roomCode).not.toBeNull()

    const hostSeesTwoPlayers = waitForState(hostRepo, (state) => state.players.length === 2)

    const joiner = await makeDevice()
    const joinerRepo = new FirestoreGameRepository({
      db: joiner.db,
      auth: joiner.auth,
      roomCode: created.roomCode ?? undefined,
    })
    // addPlayer *before* subscribe, mirroring stores/game.ts's join() — the whole point of this
    // test. Seats Alice as a room member first so her own subscribe (below) passes the
    // members-only read gate on players/roundScores from its very first snapshot.
    const aliceUid = await joinerRepo.addPlayer({ name: 'Alice', deviceUuid: 'device-a' })
    expect(joiner.auth.currentUser?.uid).toBe(aliceUid)

    const joinerSeesSelf = waitForState(joinerRepo, (state) =>
      state.players.some((player) => player.id === aliceUid),
    )

    const hostState = await hostSeesTwoPlayers
    expect(hostState.players.map((player) => player.name)).toEqual(['Host', 'Alice'])

    const joinerState = await joinerSeesSelf
    expect(joinerState.players.some((player) => player.id === aliceUid)).toBe(true)

    // The player-total update and the roundScore doc live in separate onSnapshot listeners
    // (players vs roundScores subcollections) that resolve independently — wait for BOTH to have
    // landed in the same emitted state, not just whichever settles first.
    const hostSeesScore = waitForState(
      hostRepo,
      (state) =>
        state.players.find((player) => player.id === aliceUid)?.totalScore === 12 &&
        state.roundScores.some((score) => score.playerId === aliceUid && score.round === 1),
    )
    await joinerRepo.setRoundScore({ playerId: aliceUid, round: 1, points: 12 })
    const scoredState = await hostSeesScore
    expect(scoredState.players.find((player) => player.id === aliceUid)?.totalScore).toBe(12)
    expect(scoredState.roundScores).toContainEqual({ playerId: aliceUid, round: 1, points: 12 })

    hostRepo.leave()
    joinerRepo.leave()
  })
})
