/**
 * CI-gated (test:run) unit test for `FirestoreGameRepository.finishGame`'s stats-building —
 * mocks the Firestore SDK boundary entirely (no emulator), unlike the deeper real-emulator proof
 * in tests/integration/firestore-repository.test.ts (quarantined, not in CI). This test exists
 * specifically to pin the forgery fix (docs/DECISIONS.md): the `game_player` rows finishGame
 * builds must carry each participant's own AUTH UID as `deviceUuid` — not their localStorage
 * `device_uuid` — because firestore.rules can only verify room participation
 * (`exists(room/{gameId}/players/{deviceUuid})`) against the value player docs are actually keyed
 * by.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GamePlayer, GameResult } from './types'

const ensureSignedInMock = vi.fn().mockResolvedValue('host-uid')
vi.mock('./firebase', () => ({
  ensureSignedIn: (...args: unknown[]) => ensureSignedInMock(...args),
}))

const writeGameResultMock = vi.fn().mockResolvedValue(undefined)
vi.mock('./firestore-stats', () => ({
  writeGameResult: (...args: unknown[]) => writeGameResultMock(...args),
}))

const collectionMock = vi.fn((_db: unknown, path: string) => ({ path }))
const docMock = vi.fn((_db: unknown, path: string) => ({ path }))
const getDocsMock = vi.fn()
const updateDocMock = vi.fn().mockResolvedValue(undefined)
const setDocMock = vi.fn().mockResolvedValue(undefined)
const getDocMock = vi.fn()
const batchDeleteMock = vi.fn()
const batchCommitMock = vi.fn().mockResolvedValue(undefined)
const writeBatchMock = vi.fn(() => ({ delete: batchDeleteMock, commit: batchCommitMock }))

vi.mock('firebase/firestore', () => ({
  collection: (db: unknown, path: string) => collectionMock(db, path),
  doc: (db: unknown, path: string) => docMock(db, path),
  getDoc: (ref: unknown) => getDocMock(ref),
  getDocs: (ref: unknown) => getDocsMock(ref),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: (...args: unknown[]) => args[0],
  setDoc: (...args: unknown[]) => setDocMock(...args),
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
  where: vi.fn(),
  writeBatch: () => writeBatchMock(),
}))

const { FirestoreGameRepository } = await import('./firestore-repository')

const ROOM_CODE = 'ABCDE'
const HOST_UID = 'host-uid'
const ALICE_UID = 'alice-uid'
const BOB_UID = 'bob-uid'

function playerDoc(uid: string, name: string, localDeviceUuid: string) {
  return {
    id: uid,
    data: () => ({ name, ownerUid: uid, deviceUuid: localDeviceUuid, totalScore: 0, joinOrder: 0 }),
  }
}

function roundScoreDoc(playerId: string, round: number, points: number) {
  return {
    id: `${playerId}_${round}`,
    data: () => ({ playerId, ownerUid: playerId, round, points }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ensureSignedInMock.mockResolvedValue(HOST_UID)
  updateDocMock.mockResolvedValue(undefined)
  writeGameResultMock.mockResolvedValue(undefined)
  collectionMock.mockImplementation((_db: unknown, path: string) => ({ path }))
  docMock.mockImplementation((_db: unknown, path: string) => ({ path }))
  batchCommitMock.mockResolvedValue(undefined)
  setDocMock.mockResolvedValue(undefined)
  getDocMock.mockResolvedValue({ exists: () => false, data: () => undefined })
})

describe('FirestoreGameRepository write timeouts', () => {
  const TIMEOUT_MS = 1000

  beforeEach(() => {
    vi.useFakeTimers()
    setDocMock.mockReturnValue(new Promise(() => undefined))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function repository(roomCode?: string) {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: HOST_UID } } as never,
      roomCode,
      writeTimeoutMs: TIMEOUT_MS,
      generateRoomCode: () => ROOM_CODE,
    })
  }

  it('gives up creating a room when the write never reaches the server', async () => {
    const creating = repository().createGame({ hostDeviceUuid: 'd', hostDisplayName: 'Host' })
    const assertion = await expect(creating).rejects.toMatchObject({ code: 'deadline-exceeded' })

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    await assertion
  })

  it('gives up taking a seat when the write never reaches the server', async () => {
    const joining = repository(ROOM_CODE).addPlayer({ name: 'Alice', deviceUuid: 'd' })
    const assertion = await expect(joining).rejects.toMatchObject({ code: 'deadline-exceeded' })

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    await assertion
  })
})

describe('FirestoreGameRepository.removePlayer', () => {
  function hostRepository() {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: HOST_UID } } as never,
      roomCode: ROOM_CODE,
    })
  }

  it("deletes the seat and every round's score doc in one batch", async () => {
    await hostRepository().removePlayer(ALICE_UID)

    const deletedPaths = batchDeleteMock.mock.calls.map(([ref]) => (ref as { path: string }).path)
    expect(deletedPaths).toEqual([
      `room/${ROOM_CODE}/players/${ALICE_UID}`,
      ...[1, 2, 3, 4, 5].map((round) => `room/${ROOM_CODE}/roundScores/${ALICE_UID}_${round}`),
    ])
    expect(batchCommitMock).toHaveBeenCalledTimes(1)
  })

  it("refuses to remove the host's own seat and writes nothing", async () => {
    await expect(hostRepository().removePlayer(HOST_UID)).rejects.toThrow()
    expect(batchCommitMock).not.toHaveBeenCalled()
  })
})

describe('FirestoreGameRepository.finishGame — stats-building', () => {
  it("writes game_player rows keyed by each participant's own auth uid, not their localStorage device_uuid", async () => {
    getDocsMock.mockImplementation((ref: { path: string }) => {
      if (ref.path === `room/${ROOM_CODE}/players`) {
        return Promise.resolve({
          docs: [
            playerDoc(HOST_UID, 'Host', 'device-host-local'),
            playerDoc(ALICE_UID, 'Alice', 'device-alice-local'),
            playerDoc(BOB_UID, 'Bob', 'device-bob-local'),
          ],
        })
      }
      if (ref.path === `room/${ROOM_CODE}/roundScores`) {
        const aliceRounds = [10, 40, 0, 25, 15]
        return Promise.resolve({
          docs: [
            ...[1, 2, 3, 4, 5].map((round) => roundScoreDoc(HOST_UID, round, 50)),
            ...aliceRounds.map((points, index) => roundScoreDoc(ALICE_UID, index + 1, points)),
            ...[1, 2, 3, 4, 5].map((round) => roundScoreDoc(BOB_UID, round, 20)),
          ],
        })
      }
      throw new Error(`unexpected getDocs path: ${ref.path}`)
    })

    const repo = new FirestoreGameRepository({
      db: {} as never,
      auth: {} as never,
      roomCode: ROOM_CODE,
    })

    const result = await repo.finishGame()

    expect(updateDocMock).toHaveBeenCalledWith(
      { path: `room/${ROOM_CODE}` },
      { status: 'finished' },
    )
    expect(writeGameResultMock).toHaveBeenCalledTimes(1)
    const [, writtenResult, writtenPlayers] = writeGameResultMock.mock.calls[0] as [
      unknown,
      GameResult,
      GamePlayer[],
    ]
    expect(writtenResult).toEqual(result)

    // deviceUuid on every written row is the participant's own auth uid...
    expect(writtenPlayers.map((p) => p.deviceUuid).sort()).toEqual(
      [HOST_UID, ALICE_UID, BOB_UID].sort(),
    )
    // ...never the localStorage device_uuid their player doc actually carries.
    expect(writtenPlayers.map((p) => p.deviceUuid)).not.toContain('device-host-local')
    expect(writtenPlayers.map((p) => p.deviceUuid)).not.toContain('device-alice-local')
    expect(writtenPlayers.map((p) => p.deviceUuid)).not.toContain('device-bob-local')

    const byUid = new Map(writtenPlayers.map((p) => [p.deviceUuid, p]))
    // alice's total (90) is lowest -> placement 1; bob (100) -> 2; host (250) -> 3.
    expect(byUid.get(ALICE_UID)).toMatchObject({
      displayName: 'Alice',
      finalScore: 90,
      placement: 1,
      bestRound: 0,
      worstRound: 40,
    })
    expect(byUid.get(BOB_UID)).toMatchObject({
      displayName: 'Bob',
      finalScore: 100,
      placement: 2,
      bestRound: 20,
      worstRound: 20,
    })
    expect(byUid.get(HOST_UID)).toMatchObject({
      displayName: 'Host',
      finalScore: 250,
      placement: 3,
      bestRound: 50,
      worstRound: 50,
    })

    // winnerUuid is unaffected by this fix — still the winning player's localStorage device_uuid
    // (see docs/DECISIONS.md: out of scope for the forgery fix, GameResult.winnerUuid is display
    // convenience, not used by lib/stats.ts's derivation).
    expect(result.winnerUuid).toBe('device-alice-local')
  })
})
