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
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import {
  MAX_PLAYER_NAME_LENGTH,
  MAX_ROUND_SCORE,
  ROUND_SCORE_STEP,
  TOTAL_ROUNDS,
} from '@/lib/rules'
import { playerNameKey } from '@/lib/player-names'

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

/** The name-record id exactly as firestore.rules derives it from a stored name: the rules' lower()
 * only lowercases ASCII, and the rules then fold a fixed set of Nordic capitals. Written out here,
 * not imported, so drift between the rules and playerNameKey (src/lib/player-names.ts) shows. */
function rulesNameKey(name: string): string {
  const folds: Record<string, string> = { Ä: 'ä', Ö: 'ö', Å: 'å', Ü: 'ü', É: 'é', Ø: 'ø', Æ: 'æ' }
  const lowered = name
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    .replace(/[ÄÖÅÜÉØÆ]/g, (letter) => folds[letter] ?? letter)
  return `n_${lowered.replaceAll('/', '_')}`
}

type TestFirestore = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>

/** Takes a seat the way the app does: the seat and its name record in one batch. */
function seatWithName(
  db: TestFirestore,
  uid: string,
  fields: Record<string, unknown>,
  { nameRecordOwner = uid, nameKey }: { nameRecordOwner?: string; nameKey?: string } = {},
) {
  // The test context hands out the compat Firestore type; writeBatch accepts that instance at
  // runtime but is typed for the modular one.
  const batch = writeBatch(db as unknown as Firestore)
  batch.set(doc(db, `room/${ROOM_CODE}/players/${uid}`), fields)
  if (typeof fields.name === 'string') {
    batch.set(doc(db, `room/${ROOM_CODE}/names/${nameKey ?? rulesNameKey(fields.name)}`), {
      ownerUid: nameRecordOwner,
    })
  }
  return batch.commit()
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

/** A local game's id: UUID-shaped, so it can never collide with a room code. */
const GAME_ID = 'b3f0c2a4-5d6e-4f70-8a91-2b3c4d5e6f70'

function gameResultFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    gameId: GAME_ID,
    finishedAt: '2026-01-01T00:00:00.000Z',
    totalRounds: 5,
    participantUids: [ALICE_UID],
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
    participantUids: [deviceUuid],
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

    await assertFails(seatWithName(joiner, 'newplayer-uid', playerFixture('newplayer-uid')))
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

    await assertFails(seatWithName(mallory, 'mallory-uid', playerFixture('someone-else-uid')))
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

  it('lets a player update their own totalScore', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertSucceeds(
      updateDoc(doc(alice, `room/${ROOM_CODE}/players/${ALICE_UID}`), { totalScore: 42 }),
    )
  })

  it("denies renaming a seat, which would dodge the room's unique-name records", async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      updateDoc(doc(alice, `room/${ROOM_CODE}/players/${ALICE_UID}`), { name: 'Alicia' }),
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
    return seatWithName(testEnv.authenticatedContext(ALICE_UID).firestore(), ALICE_UID, fields)
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

// A name is unique within a room, ignoring case and extra spaces. Every seat is created together
// with a names/{key} record owned by the same player; a second record under the same key is an
// update, which is never allowed, so two people can't take one name even at the same moment.
describe('unique player names', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture())
      await setDoc(
        doc(db(), `room/${ROOM_CODE}/players/${HOST_UID}`),
        playerFixture(HOST_UID, { name: 'Juho' }),
      )
      await setDoc(doc(db(), `room/${ROOM_CODE}/names/n_juho`), { ownerUid: HOST_UID })
    })
  })

  const alice = () => testEnv.authenticatedContext(ALICE_UID).firestore()
  const host = () => testEnv.authenticatedContext(HOST_UID).firestore()

  it('lets a player take a seat under a name nobody uses', async () => {
    await assertSucceeds(
      seatWithName(alice(), ALICE_UID, playerFixture(ALICE_UID, { name: 'Alice' })),
    )
  })

  it('denies a seat without its name record', async () => {
    await assertFails(
      setDoc(
        doc(alice(), `room/${ROOM_CODE}/players/${ALICE_UID}`),
        playerFixture(ALICE_UID, { name: 'Alice' }),
      ),
    )
  })

  it('denies a name someone already uses, whatever its case', async () => {
    await assertFails(seatWithName(alice(), ALICE_UID, playerFixture(ALICE_UID, { name: 'JUHO' })))
  })

  it("denies a seat that leans on someone else's name record", async () => {
    await assertFails(
      setDoc(
        doc(alice(), `room/${ROOM_CODE}/players/${ALICE_UID}`),
        playerFixture(ALICE_UID, { name: 'Juho' }),
      ),
    )
  })

  it('keys Finnish letters and slashes the same way the app does', async () => {
    const name = 'Äimä/Öhman'
    expect(rulesNameKey(name)).toBe(playerNameKey(name))

    // Succeeds only if the rules fold Ä and Ö exactly as the app's key does.
    await assertSucceeds(seatWithName(alice(), ALICE_UID, playerFixture(ALICE_UID, { name })))
    const bob = testEnv.authenticatedContext('bob-uid').firestore()
    await assertFails(
      seatWithName(bob, 'bob-uid', playerFixture('bob-uid', { name: 'ÄIMÄ/ÖHMAN' })),
    )
  })

  it.each(['Åsa', 'Über', 'Émile', 'Øyvind', 'Æsir', 'Ωmega'])(
    'seats %s: the rules and the app agree on its key',
    async (name) => {
      expect(rulesNameKey(name)).toBe(playerNameKey(name))
      await assertSucceeds(seatWithName(alice(), ALICE_UID, playerFixture(ALICE_UID, { name })))
    },
  )

  it("denies a name record that doesn't match the seat's name", async () => {
    await assertFails(
      seatWithName(alice(), ALICE_UID, playerFixture(ALICE_UID, { name: 'Alice' }), {
        nameKey: 'n_bob',
      }),
    )
  })

  it('denies a name record with no seat', async () => {
    await assertFails(
      setDoc(doc(alice(), `room/${ROOM_CODE}/names/n_alice`), { ownerUid: ALICE_UID }),
    )
  })

  it('denies names with spaces at the ends or doubled, which would dodge the check', async () => {
    await assertFails(seatWithName(alice(), ALICE_UID, playerFixture(ALICE_UID, { name: 'Juho ' })))
    await assertFails(
      seatWithName(alice(), ALICE_UID, playerFixture(ALICE_UID, { name: 'Mari  Anne' })),
    )
    await assertSucceeds(
      seatWithName(alice(), ALICE_UID, playerFixture(ALICE_UID, { name: 'Mari Anne' })),
    )
  })

  it('lets anyone signed in check whether a name is taken, but not list the names', async () => {
    await assertSucceeds(getDoc(doc(alice(), `room/${ROOM_CODE}/names/n_juho`)))
    await assertFails(getDocs(collection(alice(), `room/${ROOM_CODE}/names`)))
  })

  it('denies changing a name record, and deleting one unless you are the host', async () => {
    await assertFails(
      updateDoc(doc(alice(), `room/${ROOM_CODE}/names/n_juho`), { ownerUid: ALICE_UID }),
    )
    await assertFails(deleteDoc(doc(alice(), `room/${ROOM_CODE}/names/n_juho`)))
    await assertSucceeds(deleteDoc(doc(host(), `room/${ROOM_CODE}/names/n_juho`)))
  })

  it("frees a removed player's name once the host deletes its record with the seat", async () => {
    await seed(async (db) => {
      await setDoc(
        doc(db(), `room/${ROOM_CODE}/players/${ALICE_UID}`),
        playerFixture(ALICE_UID, { name: 'Alice' }),
      )
      await setDoc(doc(db(), `room/${ROOM_CODE}/names/n_alice`), { ownerUid: ALICE_UID })
    })
    const hostDb = host()
    const removal = writeBatch(hostDb as unknown as Firestore)
    removal.delete(doc(hostDb, `room/${ROOM_CODE}/players/${ALICE_UID}`))
    removal.delete(doc(hostDb, `room/${ROOM_CODE}/names/n_alice`))
    await assertSucceeds(removal.commit())

    const bob = testEnv.authenticatedContext('bob-uid').firestore()
    await assertSucceeds(seatWithName(bob, 'bob-uid', playerFixture('bob-uid', { name: 'Alice' })))
  })
})

describe('guest seats: players the host adds, without a phone', () => {
  const GUEST_ID = 'guest-3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'

  function guestFixture(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      name: 'Mummo',
      ownerUid: HOST_UID,
      deviceUuid: GUEST_ID,
      totalScore: 0,
      joinOrder: 1,
      isGuest: true,
      ...overrides,
    }
  }

  /** Seats a guest the way the app does: the seat and its name record, naming the seat. */
  function seatGuest(
    db: TestFirestore,
    {
      guestId = GUEST_ID,
      fields = guestFixture({ deviceUuid: guestId }) as Record<string, unknown>,
      record = { ownerUid: HOST_UID, playerId: guestId } as Record<string, unknown> | null,
    } = {},
  ) {
    const batch = writeBatch(db as unknown as Firestore)
    batch.set(doc(db, `room/${ROOM_CODE}/players/${guestId}`), fields)
    if (record) {
      batch.set(doc(db, `room/${ROOM_CODE}/names/${rulesNameKey(String(fields.name))}`), record)
    }
    return batch.commit()
  }

  const hostDb = () => testEnv.authenticatedContext(HOST_UID).firestore()

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture())
      await setDoc(
        doc(db(), `room/${ROOM_CODE}/players/${HOST_UID}`),
        playerFixture(HOST_UID, { name: 'Host' }),
      )
      await setDoc(doc(db(), `room/${ROOM_CODE}/names/${rulesNameKey('Host')}`), {
        ownerUid: HOST_UID,
      })
      await setDoc(
        doc(db(), `room/${ROOM_CODE}/players/${ALICE_UID}`),
        playerFixture(ALICE_UID, { name: 'Alice' }),
      )
    })
  })

  it('lets the host seat a guest together with its name record', async () => {
    await assertSucceeds(seatGuest(hostDb()))
  })

  it('denies anyone but the host seating a guest', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      seatGuest(alice, {
        fields: guestFixture({ ownerUid: ALICE_UID }),
        record: { ownerUid: ALICE_UID, playerId: GUEST_ID },
      }),
    )
  })

  it('denies a guest id that is not a guest id, so a guest can never pose as a signed-in player', async () => {
    await assertFails(seatGuest(hostDb(), { guestId: 'bob-uid' }))
    await assertFails(seatGuest(hostDb(), { guestId: 'guest-1' }))
    await assertFails(
      seatGuest(hostDb(), { guestId: 'guest-3F2B8C1E-9A4D-4E6F-8B7A-1C2D3E4F5A6B' }),
    )
  })

  it('denies a guest without its name record, or with a record that names no seat', async () => {
    await assertFails(seatGuest(hostDb(), { record: null }))
    await assertFails(seatGuest(hostDb(), { record: { ownerUid: HOST_UID } }))
  })

  it('denies a guest under a name already in the room, ignoring case', async () => {
    await assertFails(seatGuest(hostDb(), { fields: guestFixture({ name: 'host' }) }))
  })

  it('denies a guest seat of the wrong shape', async () => {
    await assertFails(seatGuest(hostDb(), { fields: guestFixture({ isGuest: false }) }))
    await assertFails(seatGuest(hostDb(), { fields: guestFixture({ deviceUuid: 'someone-else' }) }))
    await assertFails(seatGuest(hostDb(), { fields: guestFixture({ totalScore: 30 }) }))
    await assertFails(seatGuest(hostDb(), { fields: guestFixture({ name: ' Mummo' }) }))
    await assertFails(seatGuest(hostDb(), { fields: guestFixture({ extra: true }) }))
    const withoutFlag: Record<string, unknown> = guestFixture()
    delete withoutFlag.isGuest
    await assertFails(seatGuest(hostDb(), { fields: withoutFlag }))
  })

  it('denies a new guest once the game is finished or the room has expired', async () => {
    await seed(async (db) =>
      setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture({ status: 'finished', currentRound: 5 })),
    )
    await assertFails(seatGuest(hostDb()))

    await seed(async (db) =>
      setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture({ expiresAt: pastExpiry() })),
    )
    await assertFails(seatGuest(hostDb()))
  })

  it("denies a name record for a guest seat the writer doesn't own", async () => {
    await seed(async (db) =>
      setDoc(doc(db(), `room/${ROOM_CODE}/players/${GUEST_ID}`), guestFixture()),
    )
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(doc(alice, `room/${ROOM_CODE}/names/${rulesNameKey('Mummo')}`), {
        ownerUid: ALICE_UID,
        playerId: GUEST_ID,
      }),
    )
  })

  it("lets the host enter and correct a guest's score and running total", async () => {
    await seed(async (db) =>
      setDoc(doc(db(), `room/${ROOM_CODE}/players/${GUEST_ID}`), guestFixture()),
    )
    const host = hostDb()

    await assertSucceeds(
      setDoc(doc(host, `room/${ROOM_CODE}/roundScores/${GUEST_ID}_1`), roundScoreFixture(GUEST_ID)),
    )
    await assertSucceeds(
      updateDoc(doc(host, `room/${ROOM_CODE}/players/${GUEST_ID}`), { totalScore: 10 }),
    )
  })

  it("denies another player entering a guest's score", async () => {
    await seed(async (db) =>
      setDoc(doc(db(), `room/${ROOM_CODE}/players/${GUEST_ID}`), guestFixture()),
    )
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `room/${ROOM_CODE}/roundScores/${GUEST_ID}_1`),
        roundScoreFixture(GUEST_ID),
      ),
    )
  })

  it('lets the host remove a guest, which frees the name', async () => {
    await seatGuest(hostDb())
    const host = hostDb()

    await assertSucceeds(deleteDoc(doc(host, `room/${ROOM_CODE}/players/${GUEST_ID}`)))
    await assertSucceeds(deleteDoc(doc(host, `room/${ROOM_CODE}/names/${rulesNameKey('Mummo')}`)))
    await assertSucceeds(seatGuest(host, { guestId: 'guest-00000000-0000-4000-8000-000000000000' }))
  })

  it("lets the host write a guest's stats row when the game finishes", async () => {
    const participants = [HOST_UID, ALICE_UID, GUEST_ID]
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}/players/${GUEST_ID}`), guestFixture())
      await setDoc(
        doc(db(), `game_result/${ROOM_CODE}`),
        gameResultFixture({ gameId: ROOM_CODE, participantUids: participants }),
      )
    })

    await assertSucceeds(
      setDoc(
        doc(hostDb(), `game_player/${ROOM_CODE}_${GUEST_ID}`),
        gamePlayerFixture(ROOM_CODE, GUEST_ID, {
          participantUids: participants,
          displayName: 'Mummo',
        }),
      ),
    )
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
      updateDoc(doc(alice, `game_result/${GAME_ID}`), { finishedAt: '2030-01-01T00:00:00.000Z' }),
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
        doc(alice, `game_player/00000000-0000-4000-8000-000000000000_${ALICE_UID}`),
        gamePlayerFixture('00000000-0000-4000-8000-000000000000', ALICE_UID),
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

// Stats integrity (review round 4). Room codes and local game ids live in separate namespaces,
// every stats doc names its participants, and only participants can list or add to it.
describe('stats namespaces and participants', () => {
  it("denies a local result whose id isn't UUID-shaped, so nobody can pre-squat a room code", async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(doc(alice, `game_result/${ROOM_CODE}`), gameResultFixture({ gameId: ROOM_CODE })),
    )
  })

  it('denies a local result that lists anyone but its writer as a participant', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(
        doc(alice, `game_result/${GAME_ID}`),
        gameResultFixture({ participantUids: [ALICE_UID, 'mallory-uid'] }),
      ),
    )
  })

  it("denies a stranger adding a row to someone else's local result", async () => {
    await seed(async (db) => setDoc(doc(db(), `game_result/${GAME_ID}`), gameResultFixture()))
    const mallory = testEnv.authenticatedContext('mallory-uid').firestore()

    await assertFails(
      setDoc(
        doc(mallory, `game_player/${GAME_ID}_mallory-uid`),
        gamePlayerFixture(GAME_ID, 'mallory-uid'),
      ),
    )
    await assertFails(
      setDoc(
        doc(mallory, `game_player/${GAME_ID}_mallory-uid`),
        gamePlayerFixture(GAME_ID, 'mallory-uid', { participantUids: [ALICE_UID] }),
      ),
    )
  })

  it('denies creating a room whose code is not a room code', async () => {
    const mallory = testEnv.authenticatedContext('mallory-uid').firestore()

    await assertFails(
      setDoc(
        doc(mallory, `room/${GAME_ID}`),
        roomFixture({ code: GAME_ID, hostUid: 'mallory-uid' }),
      ),
    )
  })

  it('denies a row whose participants differ from its result', async () => {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture())
      await setDoc(doc(db(), `room/${ROOM_CODE}/players/${ALICE_UID}`), playerFixture(ALICE_UID))
      await setDoc(
        doc(db(), `game_result/${ROOM_CODE}`),
        gameResultFixture({ gameId: ROOM_CODE, participantUids: [HOST_UID, ALICE_UID] }),
      )
    })
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertFails(
      setDoc(
        doc(host, `game_player/${ROOM_CODE}_${ALICE_UID}`),
        gamePlayerFixture(ROOM_CODE, ALICE_UID, { participantUids: [HOST_UID, ALICE_UID, 'x'] }),
      ),
    )
  })

  describe('reads', () => {
    beforeEach(async () => {
      await seed(async (db) => {
        await setDoc(doc(db(), `game_result/${GAME_ID}`), gameResultFixture())
        await setDoc(
          doc(db(), `game_player/${GAME_ID}_${ALICE_UID}`),
          gamePlayerFixture(GAME_ID, ALICE_UID),
        )
      })
    })

    it('lets a participant list the rows of games they played', async () => {
      const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

      await assertSucceeds(
        getDocs(
          query(
            collection(alice, 'game_player'),
            where('gameId', 'in', [GAME_ID]),
            where('participantUids', 'array-contains', ALICE_UID),
          ),
        ),
      )
      await assertSucceeds(
        getDocs(
          query(
            collection(alice, 'game_result'),
            where('participantUids', 'array-contains', ALICE_UID),
          ),
        ),
      )
    })

    it('denies listing stats without the participant filter', async () => {
      const mallory = testEnv.authenticatedContext('mallory-uid').firestore()

      await assertFails(getDocs(collection(mallory, 'game_player')))
      await assertFails(getDocs(collection(mallory, 'game_result')))
    })

    it("denies a stranger reading someone else's stats doc", async () => {
      const mallory = testEnv.authenticatedContext('mallory-uid').firestore()

      await assertFails(getDoc(doc(mallory, `game_player/${GAME_ID}_${ALICE_UID}`)))
      await assertFails(getDoc(doc(mallory, `game_result/${GAME_ID}`)))
    })

    it('lets a writer check that a result does not exist yet before writing it', async () => {
      const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

      await assertSucceeds(getDoc(doc(alice, 'game_result/00000000-0000-4000-8000-000000000000')))
    })
  })
})

describe('room create and update values', () => {
  it('denies extra fields on a new room', async () => {
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertFails(setDoc(doc(host, `room/${ROOM_CODE}`), roomFixture({ junk: 'x' })))
  })

  it('denies a room that expires beyond the normal lifetime', async () => {
    const host = testEnv.authenticatedContext(HOST_UID).firestore()
    const inAYear = Timestamp.fromMillis(Date.now() + 365 * 24 * ONE_HOUR_MS)

    await assertFails(setDoc(doc(host, `room/${ROOM_CODE}`), roomFixture({ expiresAt: inAYear })))
  })

  describe('host updates', () => {
    beforeEach(async () => {
      await seed(async (db) => setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture()))
    })

    function hostUpdate(fields: Record<string, unknown>) {
      const host = testEnv.authenticatedContext(HOST_UID).firestore()
      return updateDoc(doc(host, `room/${ROOM_CODE}`), fields)
    }

    it('lets the host move to the next round', async () => {
      await assertSucceeds(hostUpdate({ status: 'playing', currentRound: 2 }))
    })

    it('denies skipping rounds, going back, or leaving the 1-5 range', async () => {
      await assertFails(hostUpdate({ currentRound: 3 }))
      await assertFails(hostUpdate({ currentRound: 0 }))
      await assertFails(hostUpdate({ currentRound: 'two' }))
    })

    it('denies finishing before round 5 and an unknown status', async () => {
      await assertFails(hostUpdate({ status: 'finished' }))
      await assertFails(hostUpdate({ status: 'whatever' }))
    })

    it('lets the host finish in round 5 and never reopen', async () => {
      await seed(async (db) =>
        setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture({ currentRound: 5, status: 'playing' })),
      )
      await assertSucceeds(hostUpdate({ status: 'finished' }))
      await assertFails(hostUpdate({ status: 'playing' }))
    })
  })
})

describe('play again: a finished room points at the next room', () => {
  const NEXT_CODE = 'FGHJK'

  async function seedRooms({
    finished = roomFixture({ status: 'finished', currentRound: 5 }),
    next = roomFixture({ code: NEXT_CODE }),
  }: { finished?: Record<string, unknown>; next?: Record<string, unknown> | null } = {}) {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), finished)
      if (next) await setDoc(doc(db(), `room/${NEXT_CODE}`), next)
    })
  }

  function linkAs(uid: string, fields: Record<string, unknown> = { nextRoomCode: NEXT_CODE }) {
    const db = testEnv.authenticatedContext(uid).firestore()
    return updateDoc(doc(db, `room/${ROOM_CODE}`), fields)
  }

  it("lets the host point a finished room at the host's next room, and keeps it finished", async () => {
    await seedRooms()

    await assertSucceeds(linkAs(HOST_UID))
  })

  it('lets anyone signed in read the link', async () => {
    await seedRooms({
      finished: roomFixture({ status: 'finished', currentRound: 5, nextRoomCode: NEXT_CODE }),
    })
    const stranger = testEnv.authenticatedContext('stranger-uid').firestore()

    await assertSucceeds(getDoc(doc(stranger, `room/${ROOM_CODE}`)))
  })

  it('denies anyone but the host', async () => {
    await seedRooms({ next: roomFixture({ code: NEXT_CODE, hostUid: ALICE_UID }) })

    await assertFails(linkAs(ALICE_UID))
  })

  it('denies a room that has not finished', async () => {
    await seedRooms({ finished: roomFixture({ status: 'playing', currentRound: 5 }) })

    await assertFails(linkAs(HOST_UID))
  })

  it('denies changing the link once it is set', async () => {
    await seedRooms({
      finished: roomFixture({ status: 'finished', currentRound: 5, nextRoomCode: 'LMNPQ' }),
    })

    await assertFails(linkAs(HOST_UID))
  })

  it('denies other fields with the link, so the room never reopens', async () => {
    await seedRooms()

    await assertFails(linkAs(HOST_UID, { nextRoomCode: NEXT_CODE, status: 'playing' }))
    await assertFails(linkAs(HOST_UID, { nextRoomCode: NEXT_CODE, currentRound: 1 }))
  })

  it('denies a next room someone else hosts, or one that does not exist', async () => {
    await seedRooms({ next: roomFixture({ code: NEXT_CODE, hostUid: ALICE_UID }) })
    await assertFails(linkAs(HOST_UID))

    await testEnv.clearFirestore()
    await seedRooms({ next: null })
    await assertFails(linkAs(HOST_UID))
  })

  it('denies pointing at itself or at something that is not a room code', async () => {
    await seedRooms()

    await assertFails(linkAs(HOST_UID, { nextRoomCode: ROOM_CODE }))
    await assertFails(linkAs(HOST_UID, { nextRoomCode: 'fghjk' }))
    await assertFails(linkAs(HOST_UID, { nextRoomCode: 12345 }))
  })

  it('denies linking an expired room', async () => {
    await seedRooms({
      finished: roomFixture({ status: 'finished', currentRound: 5, expiresAt: pastExpiry() }),
    })

    await assertFails(linkAs(HOST_UID))
  })

  it('denies a new room that already carries a link', async () => {
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertFails(
      setDoc(doc(host, `room/${ROOM_CODE}`), roomFixture({ nextRoomCode: NEXT_CODE })),
    )
  })
})

describe('play again: the host brings everyone along to the next room', () => {
  const NEXT_CODE = 'FGHJK'
  const BOB_UID = 'bob-uid'

  /** The finished room with Alice seated, and the host's next room it points at. */
  async function seedRooms({
    finished = roomFixture({ status: 'finished', currentRound: 5, nextRoomCode: NEXT_CODE }),
    next = roomFixture({ code: NEXT_CODE, previousRoomCode: ROOM_CODE }),
  }: { finished?: Record<string, unknown>; next?: Record<string, unknown> } = {}) {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), finished)
      await setDoc(
        doc(db(), `room/${ROOM_CODE}/players/${ALICE_UID}`),
        playerFixture(ALICE_UID, { name: 'Alice', joinOrder: 7 }),
      )
      await setDoc(doc(db(), `room/${NEXT_CODE}`), next)
      await setDoc(
        doc(db(), `room/${NEXT_CODE}/players/${HOST_UID}`),
        playerFixture(HOST_UID, { name: 'Host' }),
      )
    })
  }

  /** Seats a player of the finished room in the next one the way the host's app does: the seat
   * as it was, and a name record that is the player's own. */
  function carry(
    uid: string,
    {
      as = HOST_UID,
      fields = playerFixture(uid, { name: 'Alice', joinOrder: 7 }) as Record<string, unknown>,
      record = { ownerUid: uid } as Record<string, unknown>,
    } = {},
  ) {
    const db = testEnv.authenticatedContext(as).firestore()
    const batch = writeBatch(db as unknown as Firestore)
    batch.set(doc(db, `room/${NEXT_CODE}/players/${uid}`), fields)
    batch.set(doc(db, `room/${NEXT_CODE}/names/${rulesNameKey(String(fields.name))}`), record)
    return batch.commit()
  }

  it('lets the host seat a player of the finished room, who is then a member there', async () => {
    await seedRooms()

    await assertSucceeds(carry(ALICE_UID))
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()
    await assertSucceeds(getDocs(collection(alice, `room/${NEXT_CODE}/players`)))
  })

  it('denies anyone but the host seating someone else', async () => {
    await seedRooms()
    await seed(async (db) => {
      await setDoc(
        doc(db(), `room/${NEXT_CODE}/players/${BOB_UID}`),
        playerFixture(BOB_UID, { name: 'Bob' }),
      )
    })

    await assertFails(carry(ALICE_UID, { as: BOB_UID }))
  })

  it('denies someone who was not in the finished room', async () => {
    await seedRooms()

    await assertFails(carry(BOB_UID, { fields: playerFixture(BOB_UID, { name: 'Bob' }) }))
  })

  it('denies changing the seat on the way: the name, the device or the owner', async () => {
    await seedRooms()

    await assertFails(
      carry(ALICE_UID, { fields: playerFixture(ALICE_UID, { name: 'Alicia', joinOrder: 7 }) }),
    )
    await assertFails(
      carry(ALICE_UID, {
        fields: playerFixture(ALICE_UID, { name: 'Alice', joinOrder: 7, deviceUuid: 'other' }),
      }),
    )
    await assertFails(
      carry(ALICE_UID, {
        fields: playerFixture(HOST_UID, { name: 'Alice', joinOrder: 7 }),
        record: { ownerUid: HOST_UID },
      }),
    )
    await assertFails(
      carry(ALICE_UID, {
        fields: playerFixture(ALICE_UID, { name: 'Alice', joinOrder: 7, totalScore: 40 }),
      }),
    )
  })

  it("denies a name record that is not the player's own", async () => {
    await seedRooms()

    await assertFails(carry(ALICE_UID, { record: { ownerUid: HOST_UID } }))
    await assertFails(carry(ALICE_UID, { record: { ownerUid: ALICE_UID, playerId: ALICE_UID } }))
  })

  it('denies it unless the finished room points at this room, so a player goes along only once', async () => {
    await seedRooms({ finished: roomFixture({ status: 'finished', currentRound: 5 }) })
    await assertFails(carry(ALICE_UID))

    await testEnv.clearFirestore()
    await seedRooms({
      finished: roomFixture({ status: 'finished', currentRound: 5, nextRoomCode: 'LMNPQ' }),
    })
    await assertFails(carry(ALICE_UID))
  })

  it('denies it once the next game is under way', async () => {
    await seedRooms({
      next: roomFixture({ code: NEXT_CODE, previousRoomCode: ROOM_CODE, status: 'playing' }),
    })

    await assertFails(carry(ALICE_UID))
  })

  it('denies it into a room that names no room before it', async () => {
    await seedRooms({ next: roomFixture({ code: NEXT_CODE }) })

    await assertFails(carry(ALICE_UID))
  })

  describe('the room before, named when the next room is created', () => {
    async function seedFinished(fields: Record<string, unknown> = {}) {
      await seed(async (db) => {
        await setDoc(
          doc(db(), `room/${ROOM_CODE}`),
          roomFixture({ status: 'finished', currentRound: 5, ...fields }),
        )
      })
    }

    function createNext(previousRoomCode: unknown, as = HOST_UID) {
      const db = testEnv.authenticatedContext(as).firestore()
      return setDoc(
        doc(db, `room/${NEXT_CODE}`),
        roomFixture({ code: NEXT_CODE, hostUid: as, previousRoomCode }),
      )
    }

    it('lets the host name the finished room they hosted', async () => {
      await seedFinished()

      await assertSucceeds(createNext(ROOM_CODE))
    })

    it("denies naming someone else's room, one still being played, or none at all", async () => {
      await seedFinished()
      await assertFails(createNext(ROOM_CODE, ALICE_UID))
      await assertFails(createNext('LMNPQ'))
      await assertFails(createNext(NEXT_CODE))
      await assertFails(createNext('abcde'))

      await testEnv.clearFirestore()
      await seedFinished({ status: 'playing' })
      await assertFails(createNext(ROOM_CODE))
    })

    it('denies changing it afterwards', async () => {
      await seedFinished()
      await seed(async (db) => {
        await setDoc(
          doc(db(), `room/${NEXT_CODE}`),
          roomFixture({ code: NEXT_CODE, previousRoomCode: ROOM_CODE }),
        )
      })
      const host = testEnv.authenticatedContext(HOST_UID).firestore()

      await assertFails(updateDoc(doc(host, `room/${NEXT_CODE}`), { previousRoomCode: 'LMNPQ' }))
    })
  })

  describe('a player watching for their seat before they have one', () => {
    it('lets a player read their own seat, even before they are in the room', async () => {
      await seedRooms()
      const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

      await assertSucceeds(getDoc(doc(alice, `room/${NEXT_CODE}/players/${ALICE_UID}`)))
    })

    it("still denies them anyone else's seat", async () => {
      await seedRooms()
      const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

      await assertFails(getDoc(doc(alice, `room/${NEXT_CODE}/players/${HOST_UID}`)))
      await assertFails(getDocs(collection(alice, `room/${NEXT_CODE}/players`)))
    })
  })
})

describe('roundScores tied to the room', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture({ currentRound: 3 }))
      await setDoc(doc(db(), `room/${ROOM_CODE}/players/${ALICE_UID}`), playerFixture(ALICE_UID))
    })
  })

  function aliceScore(round: number, points = 10) {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()
    return setDoc(
      doc(alice, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_${round}`),
      roundScoreFixture(ALICE_UID, { round, points }),
    )
  }

  it('lets a player fill in a round they missed', async () => {
    await assertSucceeds(aliceScore(1))
  })

  it('denies a player changing an earlier round they already scored', async () => {
    await seed(async (db) =>
      setDoc(
        doc(db(), `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`),
        roundScoreFixture(ALICE_UID, { round: 1, points: 30 }),
      ),
    )

    await assertFails(aliceScore(1, 0))
  })

  it('lets the host correct an earlier round', async () => {
    await seed(async (db) =>
      setDoc(
        doc(db(), `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`),
        roundScoreFixture(ALICE_UID, { round: 1, points: 30 }),
      ),
    )
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertSucceeds(
      updateDoc(doc(host, `room/${ROOM_CODE}/roundScores/${ALICE_UID}_1`), { points: 25 }),
    )
  })

  it('denies scoring a round that has not started', async () => {
    await assertFails(aliceScore(4))
  })

  it('denies a stranger who never joined writing a score into the room', async () => {
    const stranger = testEnv.authenticatedContext('stranger-uid').firestore()

    await assertFails(
      setDoc(
        doc(stranger, `room/${ROOM_CODE}/roundScores/stranger-uid_3`),
        roundScoreFixture('stranger-uid', { round: 3 }),
      ),
    )
  })

  it('denies any score change once the game is finished', async () => {
    await seed(async (db) =>
      setDoc(doc(db(), `room/${ROOM_CODE}`), roomFixture({ currentRound: 5, status: 'finished' })),
    )

    await assertFails(aliceScore(5))
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

  const ROOM_PARTICIPANTS = [HOST_UID, ALICE_UID]
  const roomResult = () =>
    gameResultFixture({ gameId: ROOM_CODE, participantUids: ROOM_PARTICIPANTS })
  const roomRow = (uid: string) =>
    gamePlayerFixture(ROOM_CODE, uid, { participantUids: ROOM_PARTICIPANTS })

  it('lets the room host write the game_result for that room-backed game', async () => {
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertSucceeds(setDoc(doc(host, `game_result/${ROOM_CODE}`), roomResult()))
  })

  it('denies a non-host authenticated user writing the game_result for a room-backed game', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(setDoc(doc(alice, `game_result/${ROOM_CODE}`), roomResult()))
  })

  it("lets the host write a real participant's game_player row for a room-backed game", async () => {
    await seed(async (db) => setDoc(doc(db(), `game_result/${ROOM_CODE}`), roomResult()))
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertSucceeds(
      setDoc(doc(host, `game_player/${ROOM_CODE}_${ALICE_UID}`), roomRow(ALICE_UID)),
    )
  })

  it('denies a non-host authenticated user (even a real participant) writing a game_player row for a room-backed game', async () => {
    await seed(async (db) => setDoc(doc(db(), `game_result/${ROOM_CODE}`), roomResult()))
    const alice = testEnv.authenticatedContext(ALICE_UID).firestore()

    await assertFails(
      setDoc(doc(alice, `game_player/${ROOM_CODE}_${ALICE_UID}`), roomRow(ALICE_UID)),
    )
  })

  // THE FORGERY FIX: before this rule tightened, `isHost(gameId)` alone authorized the write —
  // the host could write a game_player row for ANY deviceUuid, including someone who never
  // joined this room at all (a fabricated "opponent" who never played). The mutation check (see
  // the report) confirms this exact test fails against the pre-fix rule.
  it('denies the host writing a game_player row for a uid that was never a participant in this room', async () => {
    await seed(async (db) => setDoc(doc(db(), `game_result/${ROOM_CODE}`), roomResult()))
    const host = testEnv.authenticatedContext(HOST_UID).firestore()

    await assertFails(
      setDoc(doc(host, `game_player/${ROOM_CODE}_never-played-uid`), roomRow('never-played-uid')),
    )
  })
})
