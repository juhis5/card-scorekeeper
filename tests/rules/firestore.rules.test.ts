/**
 * Firestore security-rules tests, run against a real Firestore emulator (see vitest.rules.config.ts
 * + `pnpm test:rules`, which wraps this in `firebase emulators:exec`). These prove the rules
 * themselves — the security boundary — not just that the app happens to behave; see the tdd +
 * firestore-realtime skills and docs/DECISIONS.md's 2026-07-24 entries, which this file verifies.
 *
 * Every fixture is seeded via `withSecurityRulesDisabled` so arranging test state never depends
 * on the rules under test — only the assertions below do.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { Timestamp, collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'

const RULES_PATH = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../firestore.rules',
)

const ROOM_CODE = 'ABCDE'
const HOST_UID = 'host-uid'
const ALICE_UID = 'alice-uid'

const ONE_HOUR_MS = 60 * 60 * 1000
const futureExpiry = () => Timestamp.fromMillis(Date.now() + ONE_HOUR_MS)
const pastExpiry = () => Timestamp.fromMillis(Date.now() - ONE_HOUR_MS)

function roomFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    code: ROOM_CODE,
    status: 'waiting',
    currentRound: 1,
    hostUid: HOST_UID,
    createdAt: Timestamp.now(),
    expiresAt: futureExpiry(),
    ...overrides,
  }
}

function playerFixture(ownerUid: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'Player',
    ownerUid,
    deviceUuid: `device-${ownerUid}`,
    totalScore: 0,
    joinOrder: 0,
    ...overrides,
  }
}

function roundScoreFixture(ownerUid: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    playerId: ownerUid,
    ownerUid,
    round: 1,
    points: 10,
    ...overrides,
  }
}

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-card-scorekeeper',
    firestore: { rules: readFileSync(RULES_PATH, 'utf8') },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
})

/** Seeds fixtures directly, bypassing rules — arrangement, not what's under test. */
async function seed(
  fn: (
    adminDb: ReturnType<RulesTestEnvironment['unauthenticatedContext']>['firestore'],
  ) => Promise<void>,
) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await fn(() => context.firestore())
  })
}

describe('room/{code} read', () => {
  it('denies an unauthenticated read of a room', async () => {
    await seed(async (db) => setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture()))

    const unauthed = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(unauthed, `room/${ROOM_CODE}`)))
  })

  it('allows any authenticated user to read the room doc (join-by-code discovery)', async () => {
    await seed(async (db) => setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture()))

    const stranger = testEnv.authenticatedContext('stranger-uid').firestore()
    await assertSucceeds(getDoc(doc(stranger, `room/${ROOM_CODE}`)))
  })

  // Firestore's `read` covers both `get` (single doc, by known code — the only thing this app
  // ever does) and `list` (collection query). `allow read` would let any authed stranger
  // enumerate every room via getDocs(collection(db,'room')) — defeating join-by-code privacy.
  // Only single-doc lookups should be allowed; the collection must never be listable.
  it('denies listing the room collection even for an authenticated user', async () => {
    await seed(async (db) => setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture()))

    const stranger = testEnv.authenticatedContext('stranger-uid').firestore()
    await assertFails(getDocs(collection(stranger, 'room')))
  })
})

describe('players/roundScores read gate — members only', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture())
      await setDoc(doc(db(), `room/${ROOM_CODE}/players/${ALICE_UID}`), playerFixture(ALICE_UID))
      await setDoc(
        doc(db(), `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`),
        roundScoreFixture(ALICE_UID),
      )
    })
  })

  it('denies a non-member authenticated user reading players or roundScores', async () => {
    const stranger = testEnv.authenticatedContext('stranger-uid').firestore()

    await assertFails(getDoc(doc(stranger, `room/${ROOM_CODE}/players/${ALICE_UID}`)))
    await assertFails(getDoc(doc(stranger, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`)))
  })

  it('allows a room member to read players and roundScores', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertSucceeds(getDoc(doc(alice, `room/${ROOM_CODE}/players/${ALICE_UID}`)))
    await assertSucceeds(getDoc(doc(alice, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`)))
  })
})

describe('roundScores own-write trust model', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture())
      await setDoc(doc(db(), `room/${ROOM_CODE}/players/${ALICE_UID}`), playerFixture(ALICE_UID))
    })
  })

  it('lets a player create and then update their own roundScore', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()
    const scoreRef = doc(alice, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`)

    await assertSucceeds(setDoc(scoreRef, roundScoreFixture(ALICE_UID, { points: 12 })))
    await assertSucceeds(updateDoc(scoreRef, { points: 30 }))
  })

  it("denies a non-host player updating another player's roundScore", async () => {
    await seed(async (db) =>
      setDoc(
        doc(db(), `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`),
        roundScoreFixture(ALICE_UID),
      ),
    )
    const bob = testEnv.authenticatedContext('bob-uid').firestore()

    await assertFails(
      updateDoc(doc(bob, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`), { points: 999 }),
    )
  })

  it("lets the host update any player's roundScore in their room", async () => {
    await seed(async (db) =>
      setDoc(
        doc(db(), `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`),
        roundScoreFixture(ALICE_UID),
      ),
    )
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertSucceeds(
      updateDoc(doc(host, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`), { points: 42 }),
    )
  })
})

// Low-total-wins means deflating your own score is SELF-SERVING, not self-defeating (the
// opposite of the old "a player can only wreck their own total" assumption) — a negative or
// falsified points value is a genuine cheating vector the own-write trust model must still
// close. Bounding the value server-side (rules) is the only enforcement point; there's no
// server to catch it otherwise.
describe('roundScores value bounds', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture())
      await setDoc(doc(db(), `room/${ROOM_CODE}/players/${ALICE_UID}`), playerFixture(ALICE_UID))
    })
  })

  it('denies a roundScore write with negative points', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`),
        roundScoreFixture(ALICE_UID, { points: -5 }),
      ),
    )
  })

  it('denies a roundScore write with points over the sanity cap', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`),
        roundScoreFixture(ALICE_UID, { points: 1001 }),
      ),
    )
  })

  it('denies a roundScore write with an out-of-range round', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_6`),
        roundScoreFixture(ALICE_UID, { round: 6 }),
      ),
    )
  })

  // Pins the doc id to `{ownerUid}_{round}` so there is structurally exactly one score per
  // player per round — an arbitrary doc id would let a client double-count a round via extra
  // sibling docs `runningTotal` would then sum together.
  it('denies a roundScore write whose doc id does not match {ownerUid}_{round}', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_wrongid`),
        roundScoreFixture(ALICE_UID),
      ),
    )
  })
})

describe('expired room rejects writes', () => {
  beforeEach(async () => {
    await seed(async (db) =>
      setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture({ expiresAt: pastExpiry() })),
    )
  })

  it('rejects a join (player create) to an expired room', async () => {
    const joiner = testEnv.authenticatedContext('newplayer-uid').firestore()

    await assertFails(
      setDoc(
        doc(joiner, `room/${ROOM_CODE}/players/newplayer-uid`),
        playerFixture('newplayer-uid'),
      ),
    )
  })

  it('rejects a roundScore write to an expired room', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`),
        roundScoreFixture(ALICE_UID),
      ),
    )
  })
})

describe('ownerUid spoofing is rejected on create', () => {
  beforeEach(async () => {
    await seed(async (db) => setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture()))
  })

  it('denies creating a player doc whose ownerUid is not the caller', async () => {
    const mallory = testEnv.authenticatedContext('mallory-uid').firestore()

    await assertFails(
      setDoc(
        doc(mallory, `room/${ROOM_CODE}/players/mallory-uid`),
        playerFixture('someone-else-uid'),
      ),
    )
  })

  it('denies creating a roundScore doc whose ownerUid is not the caller (and not the host)', async () => {
    const mallory = testEnv.authenticatedContext('mallory-uid').firestore()

    await assertFails(
      setDoc(
        doc(mallory, `room/${ROOM_CODE}/roundScores/mallory-uid_1`),
        roundScoreFixture('someone-else-uid', { playerId: 'mallory-uid' }),
      ),
    )
  })
})

// Bonus coverage beyond the 8 required cases above: the room doc's own create/update rules are
// also part of the locked design (docs/DECISIONS.md) and cheap to verify directly.
describe('room create/update authorization (bonus coverage)', () => {
  it('lets an authenticated user create a room naming themselves as host', async () => {
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertSucceeds(setDoc(doc(host, `room/${ROOM_CODE}`), roomFixture()))
  })

  it('denies creating a room that names someone else as host', async () => {
    const impostor = testEnv.authenticatedContext('impostor-uid').firestore()

    await assertFails(
      setDoc(doc(impostor, `room/${ROOM_CODE}`), roomFixture({ hostUid: HOST_UID })),
    )
  })

  it('denies a non-host updating (advancing) the room', async () => {
    await seed(async (db) => setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture()))
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(updateDoc(doc(alice, `room/${ROOM_CODE}`), { currentRound: 2 }))
  })

  it('lets the host update (advance) the room', async () => {
    await seed(async (db) => setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture()))
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertSucceeds(updateDoc(doc(host, `room/${ROOM_CODE}`), { currentRound: 2 }))
  })

  // Field-level restriction: the host's update rule only authorizes advancing status/round —
  // an unbounded expiresAt extension would undermine "rooms auto-expire" (docs/PLAN.md's Gemini
  // free-tier protection), and hostUid/code/createdAt must stay immutable identity/audit fields.
  it("denies the host extending the room's expiresAt", async () => {
    await seed(async (db) => setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture()))
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertFails(updateDoc(doc(host, `room/${ROOM_CODE}`), { expiresAt: futureExpiry() }))
  })

  it("denies the host reassigning the room's hostUid", async () => {
    await seed(async (db) => setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture()))
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertFails(updateDoc(doc(host, `room/${ROOM_CODE}`), { hostUid: 'new-host-uid' }))
  })
})

// Field-level restriction on players/{playerUid}: only name/totalScore may change. deviceUuid is
// the slice-6 stats trust anchor — a player rewriting it to someone else's key would let them
// steal or corrupt another device's persistent stats; ownerUid must stay pinned to the doc.
describe('players field-level write restrictions (bonus coverage)', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture())
      await setDoc(doc(db(), `room/${ROOM_CODE}/players/${ALICE_UID}`), playerFixture(ALICE_UID))
    })
  })

  it('denies a player rewriting their own deviceUuid', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      updateDoc(doc(alice, `room/${ROOM_CODE}/players/${ALICE_UID}`), {
        deviceUuid: 'stolen-device-uuid',
      }),
    )
  })

  it('still lets a player update their own name and totalScore', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertSucceeds(
      updateDoc(doc(alice, `room/${ROOM_CODE}/players/${ALICE_UID}`), {
        name: 'Alicia',
        totalScore: 42,
      }),
    )
  })
})
