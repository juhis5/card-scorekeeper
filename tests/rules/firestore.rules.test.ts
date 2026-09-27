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
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import {
  MAX_PLAYER_NAME_LENGTH,
  MAX_ROUND_SCORE,
  ROUND_SCORE_STEP,
  TOTAL_ROUNDS,
} from '@/lib/rules'

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

const GAME_ID = 'local-game-1'

function gameResultFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    gameId: GAME_ID,
    finishedAt: '2026-01-01T00:00:00.000Z',
    totalRounds: 5,
    winnerUuid: 'device-a',
    ...overrides,
  }
}

function gamePlayerFixture(
  gameId: string,
  deviceUuid: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    gameId,
    deviceUuid,
    displayName: 'Alice',
    finalScore: 42,
    placement: 1,
    bestRound: 0,
    worstRound: 20,
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

    await assertSucceeds(setDoc(scoreRef, roundScoreFixture(ALICE_UID, { points: 15 })))
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
      updateDoc(doc(bob, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`), { points: 995 }),
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
      updateDoc(doc(host, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`), { points: 40 }),
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

  // The cap is shared with the client's isValidRoundScore, so these two tests pin the parity:
  // if either side moves alone, one of them fails.
  it('allows a roundScore write at exactly the client-side cap', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertSucceeds(
      setDoc(
        doc(alice, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`),
        roundScoreFixture(ALICE_UID, { points: MAX_ROUND_SCORE }),
      ),
    )
  })

  it('denies a roundScore write one step over the client-side cap', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`),
        roundScoreFixture(ALICE_UID, { points: MAX_ROUND_SCORE + ROUND_SCORE_STEP }),
      ),
    )
  })

  it('denies a roundScore write with points that are not a multiple of 5', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`),
        roundScoreFixture(ALICE_UID, { points: 12 }),
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

// A seat is the room-membership key every other rule trusts, so its shape is validated: a doc
// missing joinOrder would be invisible to the orderBy('joinOrder') subscription yet still count
// as a member, and a non-string name crashes Intl.ListFormat in the winner banner.
describe('players create validation', () => {
  beforeEach(async () => {
    await seed(async (db) => setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture()))
  })

  function seatAlice(fields: Record<string, unknown>) {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()
    return setDoc(doc(alice, `room/${ROOM_CODE}/players/${ALICE_UID}`), fields)
  }

  it('lets a player seat themselves with a well-formed document', async () => {
    await assertSucceeds(seatAlice(playerFixture(ALICE_UID)))
  })

  it('denies a seat without joinOrder', async () => {
    const seat: Record<string, unknown> = playerFixture(ALICE_UID)
    delete seat.joinOrder
    await assertFails(seatAlice(seat))
  })

  it('denies a joinOrder that is not an integer', async () => {
    await assertFails(seatAlice(playerFixture(ALICE_UID, { joinOrder: 'first' })))
  })

  it('denies a name that is not a string', async () => {
    await assertFails(seatAlice(playerFixture(ALICE_UID, { name: 123 })))
  })

  it('denies an empty name', async () => {
    await assertFails(seatAlice(playerFixture(ALICE_UID, { name: '' })))
  })

  it('allows a name at the length limit and denies one over it', async () => {
    await assertSucceeds(
      seatAlice(playerFixture(ALICE_UID, { name: 'x'.repeat(MAX_PLAYER_NAME_LENGTH) })),
    )
    await assertFails(
      seatAlice(playerFixture(ALICE_UID, { name: 'x'.repeat(MAX_PLAYER_NAME_LENGTH + 1) })),
    )
  })

  it('denies extra fields', async () => {
    await assertFails(seatAlice(playerFixture(ALICE_UID, { isAdmin: true })))
  })

  it('denies a starting totalScore other than 0', async () => {
    await assertFails(seatAlice(playerFixture(ALICE_UID, { totalScore: -999 })))
  })
})

describe('players update validation', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture())
      await setDoc(doc(db(), `room/${ROOM_CODE}/players/${ALICE_UID}`), playerFixture(ALICE_UID))
    })
  })

  function updateAlice(fields: Record<string, unknown>) {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()
    return updateDoc(doc(alice, `room/${ROOM_CODE}/players/${ALICE_UID}`), fields)
  }

  it('denies renaming to a non-string', async () => {
    await assertFails(updateAlice({ name: 123 }))
  })

  it('denies renaming past the length limit', async () => {
    await assertFails(updateAlice({ name: 'x'.repeat(MAX_PLAYER_NAME_LENGTH + 1) }))
  })

  it('denies a negative totalScore', async () => {
    await assertFails(updateAlice({ totalScore: -5 }))
  })
})

describe('host removes a seat', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture())
      await setDoc(doc(db(), `room/${ROOM_CODE}/players/${HOST_UID}`), playerFixture(HOST_UID))
      await setDoc(doc(db(), `room/${ROOM_CODE}/players/${ALICE_UID}`), playerFixture(ALICE_UID))
      await setDoc(doc(db(), `room/${ROOM_CODE}/players/bob-uid`), playerFixture('bob-uid'))
      await setDoc(
        doc(db(), `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`),
        roundScoreFixture(ALICE_UID),
      )
    })
  })

  it("lets the host remove another player's seat and scores", async () => {
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertSucceeds(deleteDoc(doc(host, `room/${ROOM_CODE}/players/${ALICE_UID}`)))
    await assertSucceeds(deleteDoc(doc(host, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`)))
  })

  it('denies another player removing a seat or its scores', async () => {
    const bob = testEnv.authenticatedContext('bob-uid').firestore()

    await assertFails(deleteDoc(doc(bob, `room/${ROOM_CODE}/players/${ALICE_UID}`)))
    await assertFails(deleteDoc(doc(bob, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`)))
  })

  it('denies the host removing their own seat', async () => {
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertFails(deleteDoc(doc(host, `room/${ROOM_CODE}/players/${HOST_UID}`)))
  })

  it('denies removal once the room has expired', async () => {
    await seed(async (db) =>
      setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture({ expiresAt: Timestamp.fromMillis(1) })),
    )
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertFails(deleteDoc(doc(host, `room/${ROOM_CODE}/players/${ALICE_UID}`)))
  })
})

// Permanent stats records (docs/PLAN.md "Stats & history") are append-only: create is the only
// write ever allowed. These games have no matching `room` doc (a purely local/offline game,
// reaching Firestore only via the reconnect flush — see docs/PLAN.md "Reconnect = push final
// result only"), so their create-authorization floor is bare authed + well-formed fields (see
// docs/DECISIONS.md's create-authorization trade-off note).
describe('game_result append-only stats records (no matching room)', () => {
  it('lets an authenticated user create a game_result', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertSucceeds(setDoc(doc(alice, `game_result/${GAME_ID}`), gameResultFixture()))
  })

  it('denies an unauthenticated user creating a game_result', async () => {
    const unauthed = testEnv.unauthenticatedContext().firestore()

    await assertFails(setDoc(doc(unauthed, `game_result/${GAME_ID}`), gameResultFixture()))
  })

  it('denies updating an existing game_result', async () => {
    await seed(async (db) => setDoc(doc(db(), `game_result/${GAME_ID}`), gameResultFixture()))
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      updateDoc(doc(alice, `game_result/${GAME_ID}`), { winnerUuid: 'someone-else' }),
    )
  })

  it('denies deleting a game_result', async () => {
    await seed(async (db) => setDoc(doc(db(), `game_result/${GAME_ID}`), gameResultFixture()))
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(deleteDoc(doc(alice, `game_result/${GAME_ID}`)))
  })
})

// No `room` doc exists for GAME_ID in this describe block, so the identity anchor available is
// SELF-WRITE ONLY (deviceUuid == auth.uid) — there's no room-participant list to check against
// for a game that was never online (see the create-authorization trade-off note above the
// hybrid describe block below).
describe('game_player append-only stats records (no matching room)', () => {
  beforeEach(async () => {
    await seed(async (db) => setDoc(doc(db(), `game_result/${GAME_ID}`), gameResultFixture()))
  })

  it('lets an authenticated user create their OWN game_player row (self-write, no room)', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertSucceeds(
      setDoc(
        doc(alice, `game_player/${GAME_ID}_${ALICE_UID}`),
        gamePlayerFixture(GAME_ID, ALICE_UID),
      ),
    )
  })

  // THE FORGERY FIX: without a room to check a participant against, self-write is the only
  // identity anchor left. Before this rule tightened, `!roomExists(gameId)` alone authorized the
  // write regardless of whose deviceUuid was being claimed — any authed stranger could forge a
  // permanent, append-only win/loss row for ANY victim's deviceUuid. See the mutation-check note
  // in the PR/report: this exact test fails (i.e. `assertFails` itself fails, because the write
  // actually succeeds) against the pre-fix rule.
  it("denies an authenticated user creating a game_player row for someone ELSE's deviceUuid (no room)", async () => {
    const mallory = testEnv.authenticatedContext('mallory-uid').firestore()

    await assertFails(
      setDoc(
        doc(mallory, `game_player/${GAME_ID}_victim-device-uuid`),
        gamePlayerFixture(GAME_ID, 'victim-device-uuid'),
      ),
    )
  })

  it('denies creating a game_player row whose game_result does not exist yet', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `game_player/missing-game_${ALICE_UID}`),
        gamePlayerFixture('missing-game', ALICE_UID),
      ),
    )
  })

  it('denies an unauthenticated user creating a game_player row', async () => {
    const unauthed = testEnv.unauthenticatedContext().firestore()

    await assertFails(
      setDoc(
        doc(unauthed, `game_player/${GAME_ID}_${ALICE_UID}`),
        gamePlayerFixture(GAME_ID, ALICE_UID),
      ),
    )
  })

  it('denies a doc id that does not match {gameId}_{deviceUuid}', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(doc(alice, `game_player/mismatched-id`), gamePlayerFixture(GAME_ID, ALICE_UID)),
    )
  })

  it('denies updating an existing game_player row', async () => {
    await seed(async (db) =>
      setDoc(
        doc(db(), `game_player/${GAME_ID}_${ALICE_UID}`),
        gamePlayerFixture(GAME_ID, ALICE_UID),
      ),
    )
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      updateDoc(doc(alice, `game_player/${GAME_ID}_${ALICE_UID}`), { finalScore: 999 }),
    )
  })

  it('denies deleting a game_player row', async () => {
    await seed(async (db) =>
      setDoc(
        doc(db(), `game_player/${GAME_ID}_${ALICE_UID}`),
        gamePlayerFixture(GAME_ID, ALICE_UID),
      ),
    )
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(deleteDoc(doc(alice, `game_player/${GAME_ID}_${ALICE_UID}`)))
  })
})

// Numeric/range sanity bounds — exercised on the simpler self-write (no-room) path, but the
// checks themselves are identity-agnostic (same conditions apply on the room-backed path too).
describe('game_player value bounds (bonus coverage)', () => {
  beforeEach(async () => {
    await seed(async (db) => setDoc(doc(db(), `game_result/${GAME_ID}`), gameResultFixture()))
  })

  it('allows the largest finalScore a capped game can produce', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertSucceeds(
      setDoc(
        doc(alice, `game_player/${GAME_ID}_${ALICE_UID}`),
        gamePlayerFixture(GAME_ID, ALICE_UID, {
          finalScore: TOTAL_ROUNDS * MAX_ROUND_SCORE,
          bestRound: MAX_ROUND_SCORE,
          worstRound: MAX_ROUND_SCORE,
        }),
      ),
    )
  })

  it('denies a finalScore over the sanity cap', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `game_player/${GAME_ID}_${ALICE_UID}`),
        gamePlayerFixture(GAME_ID, ALICE_UID, { finalScore: TOTAL_ROUNDS * MAX_ROUND_SCORE + 1 }),
      ),
    )
  })

  it('denies a placement below 1', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `game_player/${GAME_ID}_${ALICE_UID}`),
        gamePlayerFixture(GAME_ID, ALICE_UID, { placement: 0 }),
      ),
    )
  })

  it('denies a placement over the sanity cap', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `game_player/${GAME_ID}_${ALICE_UID}`),
        gamePlayerFixture(GAME_ID, ALICE_UID, { placement: 51 }),
      ),
    )
  })

  it('denies a bestRound over the sanity cap', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `game_player/${GAME_ID}_${ALICE_UID}`),
        gamePlayerFixture(GAME_ID, ALICE_UID, { bestRound: MAX_ROUND_SCORE + 1 }),
      ),
    )
  })

  it('denies a worstRound over the sanity cap', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `game_player/${GAME_ID}_${ALICE_UID}`),
        gamePlayerFixture(GAME_ID, ALICE_UID, { worstRound: MAX_ROUND_SCORE + 1 }),
      ),
    )
  })
})

describe('game_result field sanity (bonus coverage)', () => {
  it('denies a totalRounds that is not the fixed 5-round game', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(doc(alice, `game_result/${GAME_ID}`), gameResultFixture({ totalRounds: 6 })),
    )
  })
})

// The stronger constraint available when a gameId DOES correspond to a live/expired online
// room: only that room's host may write its stats rows ("the host is the one finishing, so it
// writes all rows"), AND (the forgery fix) only for a deviceUuid that was actually seated as a
// real participant in that room — see docs/DECISIONS.md's create-authorization trade-off note.
describe('game_result/game_player create authorization for a room-backed game', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture())
      await setDoc(doc(db(), `room/${ROOM_CODE}/players/${ALICE_UID}`), playerFixture(ALICE_UID))
    })
  })

  it('lets the room host write the game_result for that room-backed game', async () => {
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertSucceeds(
      setDoc(doc(host, `game_result/${ROOM_CODE}`), gameResultFixture({ gameId: ROOM_CODE })),
    )
  })

  it('denies a non-host authenticated user writing the game_result for a room-backed game', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(doc(alice, `game_result/${ROOM_CODE}`), gameResultFixture({ gameId: ROOM_CODE })),
    )
  })

  it("lets the host write a real participant's game_player row for a room-backed game", async () => {
    await seed(async (db) =>
      setDoc(doc(db(), `game_result/${ROOM_CODE}`), gameResultFixture({ gameId: ROOM_CODE })),
    )
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertSucceeds(
      setDoc(
        doc(host, `game_player/${ROOM_CODE}_${ALICE_UID}`),
        gamePlayerFixture(ROOM_CODE, ALICE_UID),
      ),
    )
  })

  it('denies a non-host authenticated user (even a real participant) writing a game_player row for a room-backed game', async () => {
    await seed(async (db) =>
      setDoc(doc(db(), `game_result/${ROOM_CODE}`), gameResultFixture({ gameId: ROOM_CODE })),
    )
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `game_player/${ROOM_CODE}_${ALICE_UID}`),
        gamePlayerFixture(ROOM_CODE, ALICE_UID),
      ),
    )
  })

  // THE FORGERY FIX: before this rule tightened, `isHost(gameId)` alone authorized the write —
  // the host could write a game_player row for ANY deviceUuid, including someone who never
  // joined this room at all (a fabricated "opponent" who never played). The mutation check (see
  // the report) confirms this exact test fails against the pre-fix rule.
  it('denies the host writing a game_player row for a uid that was never a participant in this room', async () => {
    await seed(async (db) =>
      setDoc(doc(db(), `game_result/${ROOM_CODE}`), gameResultFixture({ gameId: ROOM_CODE })),
    )
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertFails(
      setDoc(
        doc(host, `game_player/${ROOM_CODE}_never-played-uid`),
        gamePlayerFixture(ROOM_CODE, 'never-played-uid'),
      ),
    )
  })
})
