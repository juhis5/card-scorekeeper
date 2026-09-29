/** The Firestore SDK is mocked here; tests/integration runs the real emulator. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GamePlayer, GameResult } from '../game/types'

const ensureSignedInMock = vi.fn().mockResolvedValue('host-uid')
vi.mock('./firebase', () => ({
  ensureSignedIn: (...args: unknown[]) => ensureSignedInMock(...args),
}))

const writeGameResultMock = vi.fn((...args: unknown[]) => Promise.resolve(args[1]))
const publishHighscoresMock = vi.fn().mockResolvedValue([])
vi.mock('./firestore-stats', () => ({
  writeGameResult: (...args: unknown[]) => writeGameResultMock(...args),
  publishHighscores: (...args: unknown[]) => publishHighscoresMock(...args),
}))

const readNameClaimMock = vi.fn()
vi.mock('./name-claims', () => ({
  readNameClaim: (...args: unknown[]) => readNameClaimMock(...args),
}))

const collectionMock = vi.fn((_db: unknown, path: string) => ({ path }))
const docMock = vi.fn((_db: unknown, path: string) => ({ path }))
const getDocsMock = vi.fn()
const updateDocMock = vi.fn().mockResolvedValue(undefined)
const setDocMock = vi.fn().mockResolvedValue(undefined)
const onSnapshotMock = vi.fn<(...args: unknown[]) => () => void>(() => () => undefined)
const getDocMock = vi.fn()
const batchSetMock = vi.fn()
const batchDeleteMock = vi.fn()
const batchCommitMock = vi.fn().mockResolvedValue(undefined)
const writeBatchMock = vi.fn(() => ({
  set: batchSetMock,
  delete: batchDeleteMock,
  commit: batchCommitMock,
}))

vi.mock('firebase/firestore', () => ({
  collection: (db: unknown, path: string) => collectionMock(db, path),
  doc: (db: unknown, path: string) => docMock(db, path),
  getDoc: (ref: unknown) => getDocMock(ref),
  getDocs: (ref: unknown) => getDocsMock(ref),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
  orderBy: vi.fn(),
  query: (...args: unknown[]) => args[0],
  serverTimestamp: () => 'server-time',
  setDoc: (...args: unknown[]) => setDocMock(...args),
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
  where: vi.fn(),
  writeBatch: () => writeBatchMock(),
}))

const { FirestoreGameRepository } = await import('./firestore-repository')
const { NameClaimedError, NameTakenError } = await import('../game/player-names')
const { GameIncompleteError } = await import('../game/rules')
const { isValidRoomCode } = await import('../game/room-code')

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
  writeGameResultMock.mockImplementation((...args: unknown[]) => Promise.resolve(args[1]))
  publishHighscoresMock.mockResolvedValue([])
  collectionMock.mockImplementation((_db: unknown, path: string) => ({ path }))
  docMock.mockImplementation((_db: unknown, path: string) => ({ path }))
  batchCommitMock.mockResolvedValue(undefined)
  setDocMock.mockResolvedValue(undefined)
  getDocMock.mockResolvedValue({ exists: () => false, data: () => undefined })
  onSnapshotMock.mockImplementation(() => () => undefined)
  readNameClaimMock.mockResolvedValue(null)
})

function snapshot(data: Record<string, unknown> | undefined) {
  return { exists: () => data !== undefined, data: () => data }
}

const permissionDenied = Object.assign(new Error('denied'), { code: 'permission-denied' })
const unavailable = Object.assign(new Error('offline'), { code: 'unavailable' })

describe('FirestoreGameRepository.findSeat', () => {
  function repository(uid: string) {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid } } as never,
      roomCode: ROOM_CODE,
    })
  }

  it("finds this device's seat and reads host status from the room", async () => {
    getDocMock.mockImplementation((ref: { path: string }) =>
      Promise.resolve(
        ref.path === `room/${ROOM_CODE}`
          ? snapshot({ hostUid: HOST_UID })
          : snapshot({ name: 'Host', ownerUid: HOST_UID }),
      ),
    )

    await expect(repository(HOST_UID).findSeat()).resolves.toEqual({
      playerId: HOST_UID,
      isHost: true,
    })
  })

  it('reports a seated joiner as not the host', async () => {
    getDocMock.mockImplementation((ref: { path: string }) =>
      Promise.resolve(
        ref.path === `room/${ROOM_CODE}`
          ? snapshot({ hostUid: HOST_UID })
          : snapshot({ name: 'Alice', ownerUid: ALICE_UID }),
      ),
    )

    await expect(repository(ALICE_UID).findSeat()).resolves.toEqual({
      playerId: ALICE_UID,
      isHost: false,
    })
  })

  it('finds no seat when the rules refuse to show it (this device never joined)', async () => {
    getDocMock.mockImplementation((ref: { path: string }) =>
      ref.path === `room/${ROOM_CODE}`
        ? Promise.resolve(snapshot({ hostUid: HOST_UID }))
        : Promise.reject(permissionDenied),
    )

    await expect(repository(ALICE_UID).findSeat()).resolves.toBeNull()
  })

  it('finds no seat when the room does not exist', async () => {
    getDocMock.mockResolvedValue(snapshot(undefined))

    await expect(repository(ALICE_UID).findSeat()).resolves.toBeNull()
  })
})

describe('FirestoreGameRepository.addPlayer when already seated', () => {
  it('keeps the existing seat instead of rewriting it, so rejoining after a reload works', async () => {
    getDocMock.mockResolvedValue(snapshot({ name: 'Alice', ownerUid: ALICE_UID, joinOrder: 7 }))
    const repo = new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: ALICE_UID } } as never,
      roomCode: ROOM_CODE,
    })

    await expect(repo.addPlayer({ name: 'Alice', deviceUuid: 'd' })).resolves.toBe(ALICE_UID)
    expect(setDocMock).not.toHaveBeenCalled()
    expect(batchCommitMock).not.toHaveBeenCalled()
  })
})

describe('FirestoreGameRepository.roomAvailability', () => {
  const NOW = 1_000_000

  function repository() {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: ALICE_UID } } as never,
      roomCode: ROOM_CODE,
      now: () => NOW,
    })
  }

  function roomSnapshot(status: string, expiresAtMs: number) {
    return snapshot({ status, hostUid: HOST_UID, expiresAt: { toMillis: () => expiresAtMs } })
  }

  it('is open for a live room that has not finished', async () => {
    getDocMock.mockResolvedValue(roomSnapshot('playing', NOW + 1))
    await expect(repository().roomAvailability()).resolves.toBe('open')
  })

  it('says an abandoned room has ended, like a finished one', async () => {
    getDocMock.mockResolvedValue(roomSnapshot('abandoned', NOW + 1))
    await expect(repository().roomAvailability()).resolves.toBe('finished')
  })

  it('says finished, expired or missing, so the join page can say so before a join fails', async () => {
    getDocMock.mockResolvedValueOnce(roomSnapshot('finished', NOW + 1))
    await expect(repository().roomAvailability()).resolves.toBe('finished')

    getDocMock.mockResolvedValueOnce(roomSnapshot('playing', NOW))
    await expect(repository().roomAvailability()).resolves.toBe('expired')

    getDocMock.mockResolvedValueOnce(snapshot(undefined))
    await expect(repository().roomAvailability()).resolves.toBe('missing')
  })
})

describe('FirestoreGameRepository unique names', () => {
  function aliceRepository() {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: ALICE_UID } } as never,
      roomCode: ROOM_CODE,
    })
  }

  function batchSetPaths(): string[] {
    return batchSetMock.mock.calls.map(([ref]) => (ref as { path: string }).path)
  }

  it('takes the seat and its name record in one batch, with the name cleaned', async () => {
    await aliceRepository().addPlayer({ name: ' Mari   Anne ', deviceUuid: 'd' })

    expect(batchSetPaths()).toEqual([
      `room/${ROOM_CODE}/players/${ALICE_UID}`,
      `room/${ROOM_CODE}/names/n_mari anne`,
    ])
    expect(batchSetMock.mock.calls[0]?.[1]).toMatchObject({ name: 'Mari Anne' })
    expect(batchSetMock.mock.calls[1]?.[1]).toEqual({ ownerUid: ALICE_UID })
    expect(batchCommitMock).toHaveBeenCalledTimes(1)
  })

  it('reports a name someone else in the room uses as NameTakenError', async () => {
    batchCommitMock.mockRejectedValueOnce(permissionDenied)
    getDocMock.mockImplementation((ref: { path: string }) =>
      Promise.resolve(
        ref.path === `room/${ROOM_CODE}/names/n_juho`
          ? snapshot({ ownerUid: BOB_UID })
          : snapshot(undefined),
      ),
    )

    const error = await aliceRepository()
      .addPlayer({ name: 'JUHO', deviceUuid: 'd' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(NameTakenError)
  })

  it('passes on a refusal that has nothing to do with the name, such as an expired room', async () => {
    batchCommitMock.mockRejectedValueOnce(permissionDenied)

    const error = await aliceRepository()
      .addPlayer({ name: 'Alice', deviceUuid: 'd' })
      .catch((caught: unknown) => caught)

    expect(error).toBe(permissionDenied)
  })

  it('seats the host with its name record, after writing the room', async () => {
    const repo = new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: HOST_UID } } as never,
      generateRoomCode: () => ROOM_CODE,
    })

    await repo.createGame({ hostDeviceUuid: 'd', hostDisplayName: 'Juho ' })

    expect(setDocMock).toHaveBeenCalledTimes(1)
    expect(batchSetPaths()).toEqual([
      `room/${ROOM_CODE}/players/${HOST_UID}`,
      `room/${ROOM_CODE}/names/n_juho`,
    ])
    expect(batchSetMock.mock.calls[0]?.[1]).toMatchObject({ name: 'Juho' })
  })
})

describe('FirestoreGameRepository claimed names', () => {
  function repository(uid: string) {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid } } as never,
      roomCode: ROOM_CODE,
      generateRoomCode: () => ROOM_CODE,
    })
  }

  it("refuses to open a room under someone else's claimed name, before writing anything", async () => {
    readNameClaimMock.mockResolvedValue({ name: 'Juho', ownerUid: BOB_UID })

    const error = await repository(HOST_UID)
      .createGame({ hostDeviceUuid: 'd', hostDisplayName: ' Juho ' })
      .catch((caught: unknown) => caught)

    expect(readNameClaimMock).toHaveBeenCalledWith(expect.anything(), 'Juho')
    expect(error).toBeInstanceOf(NameClaimedError)
    expect(setDocMock).not.toHaveBeenCalled()
  })

  it("opens the room under the host's own claimed name", async () => {
    readNameClaimMock.mockResolvedValue({ name: 'Juho', ownerUid: HOST_UID })

    await repository(HOST_UID).createGame({ hostDeviceUuid: 'd', hostDisplayName: 'Juho' })

    expect(setDocMock).toHaveBeenCalledTimes(1)
  })

  it("explains a refused seat under someone else's claimed name", async () => {
    batchCommitMock.mockRejectedValueOnce(permissionDenied)
    readNameClaimMock.mockResolvedValue({ name: 'Juho', ownerUid: BOB_UID })

    const error = await repository(ALICE_UID)
      .addPlayer({ name: 'juho', deviceUuid: 'd' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(NameClaimedError)
    expect((error as InstanceType<typeof NameClaimedError>).playerName).toBe('juho')
  })

  it('reads no claim for a seat the rules accepted', async () => {
    await repository(ALICE_UID).addPlayer({ name: 'Juho', deviceUuid: 'd' })

    expect(readNameClaimMock).not.toHaveBeenCalled()
  })
})

describe('FirestoreGameRepository guest seats', () => {
  const GUEST_ID = 'guest-3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'

  function hostRepository() {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: HOST_UID } } as never,
      roomCode: ROOM_CODE,
      now: () => 1234,
      newGuestId: () => GUEST_ID.slice('guest-'.length),
    })
  }

  it('seats a guest owned by the host, with a name record naming the seat, in one batch', async () => {
    const playerId = await hostRepository().addGuest({ name: ' Mummo ' })

    expect(playerId).toBe(GUEST_ID)
    expect(
      batchSetMock.mock.calls.map(([ref, data]) => [(ref as { path: string }).path, data]),
    ).toEqual([
      [
        `room/${ROOM_CODE}/players/${GUEST_ID}`,
        {
          name: 'Mummo',
          ownerUid: HOST_UID,
          deviceUuid: GUEST_ID,
          totalScore: 0,
          joinOrder: 1234,
          isGuest: true,
        },
      ],
      [`room/${ROOM_CODE}/names/n_mummo`, { ownerUid: HOST_UID, playerId: GUEST_ID }],
    ])
    expect(batchCommitMock).toHaveBeenCalledTimes(1)
  })

  it("reports a name that's already in the room, even the host's own, as NameTakenError", async () => {
    batchCommitMock.mockRejectedValueOnce(permissionDenied)
    getDocMock.mockResolvedValue(snapshot({ ownerUid: HOST_UID }))

    const error = await hostRepository()
      .addGuest({ name: 'Host' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(NameTakenError)
  })

  it('tells a joiner when the name they want belongs to a guest', async () => {
    batchCommitMock.mockRejectedValueOnce(permissionDenied)
    getDocMock.mockImplementation((ref: { path: string }) =>
      Promise.resolve(
        ref.path === `room/${ROOM_CODE}/names/n_mummo`
          ? snapshot({ ownerUid: HOST_UID, playerId: GUEST_ID })
          : snapshot(undefined),
      ),
    )
    const joiner = new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: ALICE_UID } } as never,
      roomCode: ROOM_CODE,
    })

    const error = await joiner
      .addPlayer({ name: 'Mummo', deviceUuid: 'd' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(NameTakenError)
    expect((error as InstanceType<typeof NameTakenError>).isGuestSeat).toBe(true)
  })

  it('marks guest seats in the state it passes on', () => {
    const onChange = vi.fn()
    hostRepository().subscribe(onChange)
    const [onRoom, onPlayers] = onSnapshotMock.mock.calls.map(
      (call) => (call as unknown[])[1] as (snapshot: unknown) => void,
    )

    onRoom?.({ data: () => ({ status: 'waiting', currentRound: 1 }) })
    onPlayers?.({
      docs: [
        playerDoc(HOST_UID, 'Host', 'd'),
        {
          id: GUEST_ID,
          data: () => ({
            name: 'Mummo',
            ownerUid: HOST_UID,
            deviceUuid: GUEST_ID,
            totalScore: 0,
            joinOrder: 1,
            isGuest: true,
          }),
        },
      ],
    })

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        players: [
          { id: HOST_UID, name: 'Host', totalScore: 0 },
          { id: GUEST_ID, name: 'Mummo', totalScore: 0, isGuest: true },
        ],
      }),
    )
  })
})

describe('FirestoreGameRepository scores', () => {
  function repository() {
    return new FirestoreGameRepository({ db: {} as never, auth: {} as never, roomCode: ROOM_CODE })
  }

  it('saves a score as one write with no read first, so it shows at once and never waits offline', async () => {
    await repository().setRoundScore({ playerId: ALICE_UID, round: 2, points: 15 })

    expect(getDocsMock).not.toHaveBeenCalled()
    expect(setDocMock).toHaveBeenCalledTimes(1)
    expect(setDocMock).toHaveBeenCalledWith(
      { path: `room/${ROOM_CODE}/roundScores/${ALICE_UID}_2` },
      { playerId: ALICE_UID, ownerUid: ALICE_UID, round: 2, points: 15 },
    )
  })

  it("passes on totals summed from the round scores, never the seat's stored totalScore", () => {
    const onChange = vi.fn()
    repository().subscribe(onChange)
    const [onRoom, onPlayers, onScores] = onSnapshotMock.mock.calls.map(
      (call) => (call as unknown[])[1] as (snapshot: unknown) => void,
    )

    onRoom?.({ data: () => ({ status: 'playing', currentRound: 2 }) })
    onPlayers?.({
      docs: [{ id: ALICE_UID, data: () => ({ name: 'Alice', totalScore: 999, joinOrder: 0 }) }],
    })
    onScores?.({ docs: [roundScoreDoc(ALICE_UID, 1, 10), roundScoreDoc(ALICE_UID, 2, 15)] })

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ players: [{ id: ALICE_UID, name: 'Alice', totalScore: 25 }] }),
    )
  })
})

describe('FirestoreGameRepository.subscribe errors', () => {
  it("reports a listener error, such as losing this device's seat, to the caller", () => {
    const onError = vi.fn()
    const repo = new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: ALICE_UID } } as never,
      roomCode: ROOM_CODE,
    })

    repo.subscribe(() => undefined, onError)
    const errorCallbacks = onSnapshotMock.mock.calls.map((call) => (call as unknown[])[2])
    ;(errorCallbacks[1] as (error: unknown) => void)(permissionDenied)

    expect(errorCallbacks).toHaveLength(3)
    expect(onError).toHaveBeenCalledWith(permissionDenied)
  })
})

describe('FirestoreGameRepository play again', () => {
  const NEXT_CODE = 'FGHJK'

  function repository() {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: HOST_UID } } as never,
      roomCode: ROOM_CODE,
    })
  }

  function emitRoom(data: Record<string, unknown>): void {
    const onRoom = (onSnapshotMock.mock.calls[0] as unknown[])[1] as (snapshot: unknown) => void
    onRoom({ data: () => data })
  }

  it("passes the room's link to the next room on to every device", () => {
    const onChange = vi.fn()
    repository().subscribe(onChange)

    emitRoom({ status: 'finished', currentRound: 5, nextRoomCode: NEXT_CODE })

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ nextRoomCode: NEXT_CODE }))
  })

  it('ignores a link that is not a room code', () => {
    const onChange = vi.fn()
    repository().subscribe(onChange)

    emitRoom({ status: 'finished', currentRound: 5, nextRoomCode: 'not a code' })

    expect(onChange).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ nextRoomCode: 'not a code' }),
    )
  })

  it('abandons the room for everyone in it', async () => {
    await repository().abandonGame()

    expect(updateDocMock).toHaveBeenCalledWith(
      { path: `room/${ROOM_CODE}` },
      { status: 'abandoned' },
    )
  })

  it('points the finished room at the next room', async () => {
    await repository().linkNextRoom(NEXT_CODE)

    expect(updateDocMock).toHaveBeenCalledWith(
      { path: `room/${ROOM_CODE}` },
      { nextRoomCode: NEXT_CODE },
    )
  })

  it('tells this device once it has a seat in the next room, so it can move there', () => {
    const onChange = vi.fn()
    new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: ALICE_UID } } as never,
      roomCode: ROOM_CODE,
    }).subscribe(onChange)

    emitRoom({ status: 'finished', currentRound: 5, nextRoomCode: NEXT_CODE })
    const seatWatch = onSnapshotMock.mock.calls.find(
      (call) => (call[0] as { path: string }).path === `room/${NEXT_CODE}/players/${ALICE_UID}`,
    )
    expect(onChange).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ hasSeatInNextRoom: true }),
    )
    ;(seatWatch?.[1] as (snapshot: unknown) => void)({ exists: () => true })

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ nextRoomCode: NEXT_CODE, hasSeatInNextRoom: true }),
    )
  })
})

describe('FirestoreGameRepository bringing everyone along (Play again)', () => {
  const NEXT_CODE = 'FGHJK'
  const GUEST_ID = 'guest-3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'

  function nextRoomRepository() {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: HOST_UID } } as never,
      generateRoomCode: () => NEXT_CODE,
    })
  }

  function seatDoc(id: string, fields: Record<string, unknown>) {
    return { id, data: () => ({ totalScore: 35, ...fields }) }
  }

  const FINISHED_SEATS = [
    seatDoc(HOST_UID, {
      name: 'Host',
      ownerUid: HOST_UID,
      deviceUuid: 'device-host',
      joinOrder: 0,
    }),
    seatDoc(ALICE_UID, {
      name: 'Alice',
      ownerUid: ALICE_UID,
      deviceUuid: 'device-alice',
      joinOrder: 7,
    }),
    seatDoc(GUEST_ID, {
      name: 'Mummo',
      ownerUid: HOST_UID,
      deviceUuid: GUEST_ID,
      joinOrder: 9,
      isGuest: true,
    }),
  ]

  async function nextRoom() {
    const repo = nextRoomRepository()
    await repo.createNextGame({ hostDeviceUuid: 'device-host', hostDisplayName: 'Host' }, ROOM_CODE)
    batchSetMock.mockClear()
    batchCommitMock.mockClear()
    getDocsMock.mockResolvedValue({ docs: FINISHED_SEATS })
    return repo
  }

  it('creates the next room naming the finished room its players come from', async () => {
    await nextRoom()

    expect(setDocMock).toHaveBeenCalledWith(
      { path: `room/${NEXT_CODE}` },
      expect.objectContaining({ code: NEXT_CODE, previousRoomCode: ROOM_CODE }),
    )
  })

  it('seats everyone else as they were, each in a batch of its own, starting from nothing', async () => {
    const repo = await nextRoom()

    await repo.carrySeats()

    expect(getDocsMock).toHaveBeenCalledWith({ path: `room/${ROOM_CODE}/players` })
    expect(
      batchSetMock.mock.calls.map(([ref, data]) => [(ref as { path: string }).path, data]),
    ).toEqual([
      [
        `room/${NEXT_CODE}/players/${ALICE_UID}`,
        {
          name: 'Alice',
          ownerUid: ALICE_UID,
          deviceUuid: 'device-alice',
          totalScore: 0,
          joinOrder: 7,
        },
      ],
      [`room/${NEXT_CODE}/names/n_alice`, { ownerUid: ALICE_UID }],
      [
        `room/${NEXT_CODE}/players/${GUEST_ID}`,
        {
          name: 'Mummo',
          ownerUid: HOST_UID,
          deviceUuid: GUEST_ID,
          totalScore: 0,
          joinOrder: 9,
          isGuest: true,
        },
      ],
      [`room/${NEXT_CODE}/names/n_mummo`, { ownerUid: HOST_UID, playerId: GUEST_ID }],
    ])
    expect(batchCommitMock).toHaveBeenCalledTimes(2)
  })

  it('still seats the others when one seat is refused, such as a player who joined first', async () => {
    const repo = await nextRoom()
    batchCommitMock.mockRejectedValueOnce(permissionDenied)

    await expect(repo.carrySeats()).resolves.toBeUndefined()
    expect(batchCommitMock).toHaveBeenCalledTimes(2)
  })

  it('brings nobody along into a room that was not started from a finished one', async () => {
    const repo = nextRoomRepository()
    await repo.createGame({ hostDeviceUuid: 'device-host', hostDisplayName: 'Host' })

    await expect(repo.carrySeats()).rejects.toThrow()
  })

  it('counts a seat the host brought along meanwhile as joined, not as a refusal', async () => {
    batchCommitMock.mockRejectedValueOnce(permissionDenied)
    getDocMock
      .mockResolvedValueOnce(snapshot(undefined))
      .mockResolvedValueOnce(snapshot({ name: 'Alice', ownerUid: ALICE_UID, joinOrder: 7 }))
    const repo = new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: ALICE_UID } } as never,
      roomCode: NEXT_CODE,
    })

    await expect(repo.addPlayer({ name: 'Alice', deviceUuid: 'd' })).resolves.toBe(ALICE_UID)
  })
})

describe('FirestoreGameRepository write timeouts', () => {
  const TIMEOUT_MS = 1000

  beforeEach(() => {
    vi.useFakeTimers()
    setDocMock.mockReturnValue(new Promise(() => undefined))
    batchCommitMock.mockReturnValue(new Promise(() => undefined))
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
    const outcome = repository()
      .createGame({ hostDeviceUuid: 'd', hostDisplayName: 'Host' })
      .catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(await outcome).toMatchObject({ code: 'deadline-exceeded' })
  })

  it('gives up pointing at the next room when the write never reaches the server', async () => {
    updateDocMock.mockReturnValue(new Promise(() => undefined))
    const outcome = repository(ROOM_CODE)
      .linkNextRoom('FGHJK')
      .catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(await outcome).toMatchObject({ code: 'deadline-exceeded' })
  })

  it('gives up removing a player when the write never reaches the server', async () => {
    const outcome = repository(ROOM_CODE)
      .removePlayer(ALICE_UID)
      .catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(await outcome).toMatchObject({ code: 'deadline-exceeded' })
  })

  it('gives up finishing when the stats write never reaches the server', async () => {
    getDocsMock.mockImplementation((ref: { path: string }) =>
      Promise.resolve(
        ref.path === `room/${ROOM_CODE}/players`
          ? { docs: [playerDoc(HOST_UID, 'Host', 'd'), playerDoc(ALICE_UID, 'Alice', 'd')] }
          : {
              docs: [1, 2, 3, 4, 5].flatMap((round) => [
                roundScoreDoc(HOST_UID, round, 20),
                roundScoreDoc(ALICE_UID, round, 0),
              ]),
            },
      ),
    )
    getDocMock.mockResolvedValue(snapshot({ status: 'playing', currentRound: 5 }))
    writeGameResultMock.mockReturnValue(new Promise(() => undefined))
    const outcome = repository(ROOM_CODE)
      .finishGame()
      .catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(await outcome).toMatchObject({ code: 'deadline-exceeded' })
    expect(updateDocMock).not.toHaveBeenCalled()
  })

  it('gives up taking a seat when the write never reaches the server', async () => {
    const outcome = repository(ROOM_CODE)
      .addPlayer({ name: 'Alice', deviceUuid: 'd' })
      .catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(await outcome).toMatchObject({ code: 'deadline-exceeded' })
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

  it("deletes the seat, its name record and every round's score doc in one batch", async () => {
    getDocMock.mockResolvedValue(snapshot({ name: 'Alice', ownerUid: ALICE_UID, joinOrder: 1 }))

    await hostRepository().removePlayer(ALICE_UID)

    const deletedPaths = batchDeleteMock.mock.calls.map(([ref]) => (ref as { path: string }).path)
    expect(deletedPaths).toEqual([
      `room/${ROOM_CODE}/players/${ALICE_UID}`,
      `room/${ROOM_CODE}/names/n_alice`,
      ...[1, 2, 3, 4, 5].map((round) => `room/${ROOM_CODE}/roundScores/${ALICE_UID}_${round}`),
    ])
    expect(batchCommitMock).toHaveBeenCalledTimes(1)
  })

  it("refuses to remove the host's own seat and writes nothing", async () => {
    await expect(hostRepository().removePlayer(HOST_UID)).rejects.toThrow()
    expect(batchCommitMock).not.toHaveBeenCalled()
  })
})

describe('FirestoreGameRepository.finishGame — order', () => {
  function installFinishedRoom(): void {
    getDocsMock.mockImplementation((ref: { path: string }) => {
      if (ref.path === `room/${ROOM_CODE}/players`) {
        return Promise.resolve({
          docs: [
            playerDoc(HOST_UID, 'Host', 'device-host-local'),
            playerDoc(ALICE_UID, 'Alice', 'device-alice-local'),
          ],
        })
      }
      if (ref.path === `room/${ROOM_CODE}/roundScores`) {
        return Promise.resolve({
          docs: [1, 2, 3, 4, 5].flatMap((round) => [
            roundScoreDoc(HOST_UID, round, 20),
            roundScoreDoc(ALICE_UID, round, 0),
          ]),
        })
      }
      throw new Error(`unexpected getDocs path: ${ref.path}`)
    })
    getDocMock.mockResolvedValue(snapshot({ status: 'playing', currentRound: 5 }))
  }

  function makeRepo() {
    return new FirestoreGameRepository({ db: {} as never, auth: {} as never, roomCode: ROOM_CODE })
  }

  it('writes the stats before marking the room finished', async () => {
    // Everyone sees the winner as soon as the room is finished, and may open Stats right away.
    installFinishedRoom()

    await makeRepo().finishGame()

    const [statsWriteOrder] = writeGameResultMock.mock.invocationCallOrder
    const [roomUpdateOrder] = updateDocMock.mock.invocationCallOrder
    expect(statsWriteOrder).toBeLessThan(roomUpdateOrder ?? 0)
  })

  it('publishes the highscores only after the room is finished, as the rules require', async () => {
    installFinishedRoom()

    await makeRepo().finishGame()

    const [roomUpdateOrder] = updateDocMock.mock.invocationCallOrder
    const [publishOrder] = publishHighscoresMock.mock.invocationCallOrder
    expect(roomUpdateOrder).toBeLessThan(publishOrder ?? 0)
  })

  it('publishes a retried Finish whose room is already finished, without writing the room again', async () => {
    installFinishedRoom()
    getDocMock.mockResolvedValue(snapshot({ status: 'finished', currentRound: 5 }))

    await makeRepo().finishGame()

    expect(updateDocMock).not.toHaveBeenCalled()
    expect(publishHighscoresMock).toHaveBeenCalledTimes(1)
  })

  it('queues the entries that failed to publish, to retry once back online', async () => {
    installFinishedRoom()
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    }
    publishHighscoresMock.mockImplementation((_db: unknown, _result: unknown, players: unknown[]) =>
      Promise.resolve(players.slice(0, 1)),
    )
    const repo = new FirestoreGameRepository({
      db: {} as never,
      auth: {} as never,
      roomCode: ROOM_CODE,
      storage,
    })

    await repo.finishGame()

    const queued = JSON.parse(values.get('card-scorekeeper:pending-highscores') ?? '[]')
    expect(queued).toHaveLength(1)
    expect(queued[0].result.gameId).toBe(ROOM_CODE)
    expect(queued[0].players).toHaveLength(1)
  })

  it('leaves the room unfinished when the stats write fails, so Finish can be retried', async () => {
    installFinishedRoom()
    writeGameResultMock.mockRejectedValueOnce(new Error('offline'))

    const error = await makeRepo()
      .finishGame()
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(updateDocMock).not.toHaveBeenCalled()
  })
})

describe('FirestoreGameRepository.finishGame — gate', () => {
  function repo() {
    return new FirestoreGameRepository({ db: {} as never, auth: {} as never, roomCode: ROOM_CODE })
  }

  function installScores(roundsScored: number, currentRound: number): void {
    getDocsMock.mockImplementation((ref: { path: string }) =>
      Promise.resolve(
        ref.path === `room/${ROOM_CODE}/players`
          ? { docs: [playerDoc(HOST_UID, 'Host', 'd'), playerDoc(ALICE_UID, 'Alice', 'd')] }
          : {
              docs: [1, 2, 3, 4, 5]
                .slice(0, roundsScored)
                .flatMap((round) => [
                  roundScoreDoc(HOST_UID, round, 20),
                  roundScoreDoc(ALICE_UID, round, 0),
                ]),
            },
      ),
    )
    getDocMock.mockResolvedValue(snapshot({ status: 'playing', currentRound }))
  }

  it('writes no stats when finished before the last round', async () => {
    installScores(3, 3)

    await expect(repo().finishGame()).rejects.toBeInstanceOf(GameIncompleteError)
    expect(writeGameResultMock).not.toHaveBeenCalled()
    expect(updateDocMock).not.toHaveBeenCalled()
  })

  it('writes no stats while a seated player has no score for the last round', async () => {
    installScores(4, 5)

    await expect(repo().finishGame()).rejects.toBeInstanceOf(GameIncompleteError)
    expect(writeGameResultMock).not.toHaveBeenCalled()
  })
})

describe('FirestoreGameRepository.advanceRound', () => {
  it('writes the round after the one it was asked to move from, with no read, so a repeat is a no-op', async () => {
    const repo = new FirestoreGameRepository({
      db: {} as never,
      auth: {} as never,
      roomCode: ROOM_CODE,
    })

    await repo.advanceRound(2)
    await repo.advanceRound(2)

    expect(getDocMock).not.toHaveBeenCalled()
    expect(updateDocMock.mock.calls).toEqual([
      [{ path: `room/${ROOM_CODE}` }, { status: 'playing', currentRound: 3 }],
      [{ path: `room/${ROOM_CODE}` }, { status: 'playing', currentRound: 3 }],
    ])
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
            // Bob goes out whenever Alice doesn't: exactly one 0 a round.
            ...aliceRounds.map((points, index) =>
              roundScoreDoc(BOB_UID, index + 1, points === 0 ? 20 : 0),
            ),
          ],
        })
      }
      throw new Error(`unexpected getDocs path: ${ref.path}`)
    })
    getDocMock.mockResolvedValue(snapshot({ status: 'playing', currentRound: 5 }))

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
    // bob's total (20) is lowest -> placement 1; alice (90) -> 2; host (250) -> 3.
    expect(byUid.get(ALICE_UID)).toMatchObject({
      displayName: 'Alice',
      finalScore: 90,
      placement: 2,
      bestRound: 0,
      worstRound: 40,
    })
    expect(byUid.get(BOB_UID)).toMatchObject({
      displayName: 'Bob',
      finalScore: 20,
      placement: 1,
      bestRound: 0,
      worstRound: 20,
    })
    expect(byUid.get(HOST_UID)).toMatchObject({
      displayName: 'Host',
      finalScore: 250,
      placement: 3,
      bestRound: 50,
      worstRound: 50,
    })
  })
})

describe('FirestoreGameRepository.createGame room codes', () => {
  const HOST_CONFIG = { hostDeviceUuid: 'd', hostDisplayName: 'Host' }

  function hostRepository(generateRoomCode?: () => string) {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: HOST_UID } } as never,
      generateRoomCode,
    })
  }

  function roomPathsWritten(): string[] {
    return setDocMock.mock.calls.map(([ref]) => (ref as { path: string }).path)
  }

  it('mints a valid room code when none is injected', async () => {
    const created = await hostRepository().createGame(HOST_CONFIG)

    expect(isValidRoomCode(created.roomCode ?? '')).toBe(true)
    expect(roomPathsWritten()).toEqual([`room/${created.roomCode}`])
  })

  it('tries a fresh code when the first one belongs to an existing room', async () => {
    const codes = ['AAAAA', 'BBBBB']
    setDocMock.mockRejectedValueOnce(permissionDenied)

    const created = await hostRepository(() => codes.shift() ?? 'ZZZZZ').createGame(HOST_CONFIG)

    expect(created).toEqual({ gameId: 'BBBBB', roomCode: 'BBBBB', hostPlayerId: HOST_UID })
    expect(roomPathsWritten()).toEqual(['room/AAAAA', 'room/BBBBB'])
  })

  it('gives up after five colliding codes, passing on the refusal', async () => {
    setDocMock.mockRejectedValue(permissionDenied)

    const error = await hostRepository(() => ROOM_CODE)
      .createGame(HOST_CONFIG)
      .catch((caught: unknown) => caught)

    expect(error).toBe(permissionDenied)
    expect(setDocMock).toHaveBeenCalledTimes(5)
  })

  it('passes on a failure that is not a collision without trying another code', async () => {
    setDocMock.mockRejectedValueOnce(unavailable)

    const error = await hostRepository(() => ROOM_CODE)
      .createGame(HOST_CONFIG)
      .catch((caught: unknown) => caught)

    expect(error).toBe(unavailable)
    expect(setDocMock).toHaveBeenCalledTimes(1)
  })

  it('refuses to create a room when sign-in left this device without a uid', async () => {
    const repo = new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: null } as never,
      generateRoomCode: () => ROOM_CODE,
    })

    await expect(repo.createGame(HOST_CONFIG)).rejects.toThrow(/not signed in/)
    expect(setDocMock).not.toHaveBeenCalled()
  })
})

describe('FirestoreGameRepository seat refusals', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function repository(uid: string, deps: { newGuestId?: () => string } = {}) {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid } } as never,
      roomCode: ROOM_CODE,
      ...deps,
    })
  }

  it("passes on the refusal, not a name clash, when the name record is this device's own", async () => {
    batchCommitMock.mockRejectedValueOnce(permissionDenied)
    getDocMock.mockImplementation((ref: { path: string }) =>
      Promise.resolve(
        ref.path === `room/${ROOM_CODE}/names/n_alice`
          ? snapshot({ ownerUid: ALICE_UID })
          : snapshot(undefined),
      ),
    )

    const error = await repository(ALICE_UID)
      .addPlayer({ name: 'Alice', deviceUuid: 'd' })
      .catch((caught: unknown) => caught)

    expect(error).toBe(permissionDenied)
  })

  it('takes a guest seat id from crypto.randomUUID when none is injected', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')

    const guestId = await repository(HOST_UID).addGuest({ name: 'Mummo' })

    expect(guestId).toBe('guest-00000000-0000-4000-8000-000000000001')
  })

  it('passes on a guest refusal when no seat in the room has the name', async () => {
    batchCommitMock.mockRejectedValueOnce(permissionDenied)

    const error = await repository(HOST_UID)
      .addGuest({ name: 'Mummo' })
      .catch((caught: unknown) => caught)

    expect(error).toBe(permissionDenied)
  })

  it('passes on a guest write failure that is not a refusal, without looking up the name', async () => {
    batchCommitMock.mockRejectedValueOnce(unavailable)

    const error = await repository(HOST_UID)
      .addGuest({ name: 'Mummo' })
      .catch((caught: unknown) => caught)

    expect(error).toBe(unavailable)
    expect(getDocMock).not.toHaveBeenCalled()
  })

  it('passes on a failure to read the seat that is not a refusal', async () => {
    getDocMock.mockImplementation((ref: { path: string }) =>
      ref.path === `room/${ROOM_CODE}`
        ? Promise.resolve(snapshot({ hostUid: HOST_UID }))
        : Promise.reject(unavailable),
    )

    await expect(repository(ALICE_UID).findSeat()).rejects.toBe(unavailable)
  })
})

describe('FirestoreGameRepository.subscribe lifecycle', () => {
  const NEXT_CODE = 'FGHJK'

  function repository(uid: string | null = ALICE_UID) {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: uid === null ? null : { uid } } as never,
      roomCode: ROOM_CODE,
    })
  }

  function listenerAt(index: number, argument: 1 | 2): (value: unknown) => void {
    return (onSnapshotMock.mock.calls[index] as unknown[])[argument] as (value: unknown) => void
  }

  function nextSeatWatches() {
    return onSnapshotMock.mock.calls.filter((call) =>
      (call[0] as { path: string }).path.startsWith(`room/${NEXT_CODE}/`),
    )
  }

  it('emits nothing until the room doc has arrived', () => {
    const onChange = vi.fn()
    repository().subscribe(onChange)

    listenerAt(1, 1)({ docs: [playerDoc(ALICE_UID, 'Alice', 'd')] })
    listenerAt(2, 1)({ docs: [] })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('emits nothing for a room doc with no data, as when the room is gone', () => {
    const onChange = vi.fn()
    repository().subscribe(onChange)

    listenerAt(0, 1)({ data: () => undefined })
    listenerAt(1, 1)({ docs: [playerDoc(ALICE_UID, 'Alice', 'd')] })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('watches for its seat in the next room only once, however often the link arrives', () => {
    repository().subscribe(() => undefined)
    const linkedRoom = { status: 'finished', currentRound: 5, nextRoomCode: NEXT_CODE }

    listenerAt(0, 1)({ data: () => linkedRoom })
    listenerAt(0, 1)({ data: () => linkedRoom })

    expect(nextSeatWatches()).toHaveLength(1)
  })

  it('does not watch the next room while no user is signed in', () => {
    const onChange = vi.fn()
    repository(null).subscribe(onChange)

    listenerAt(
      0,
      1,
    )({ data: () => ({ status: 'finished', currentRound: 5, nextRoomCode: NEXT_CODE }) })

    expect(nextSeatWatches()).toHaveLength(0)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ nextRoomCode: NEXT_CODE }))
  })

  it('keeps a failed watch on the next-room seat to itself, as the join button still works', () => {
    const onChange = vi.fn()
    const onError = vi.fn()
    repository().subscribe(onChange, onError)
    listenerAt(
      0,
      1,
    )({ data: () => ({ status: 'finished', currentRound: 5, nextRoomCode: NEXT_CODE }) })
    const changesBefore = onChange.mock.calls.length

    listenerAt(3, 2)(permissionDenied)

    expect(onError).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledTimes(changesBefore)
  })

  it('stops every listener, the next-room seat watch included, on unsubscribe', () => {
    const stops: ReturnType<typeof vi.fn>[] = []
    onSnapshotMock.mockImplementation(() => {
      const stop = vi.fn()
      stops.push(stop)
      return stop
    })
    const unsubscribe = repository().subscribe(() => undefined)
    listenerAt(
      0,
      1,
    )({ data: () => ({ status: 'finished', currentRound: 5, nextRoomCode: NEXT_CODE }) })

    unsubscribe()

    expect(stops).toHaveLength(4)
    stops.forEach((stop) => expect(stop).toHaveBeenCalledTimes(1))
  })

  it('stops every open subscription on leave', () => {
    const stops: ReturnType<typeof vi.fn>[] = []
    onSnapshotMock.mockImplementation(() => {
      const stop = vi.fn()
      stops.push(stop)
      return stop
    })
    const repo = repository()
    repo.subscribe(() => undefined)
    repo.subscribe(() => undefined)

    repo.leave()

    expect(stops).toHaveLength(6)
    stops.forEach((stop) => expect(stop).toHaveBeenCalledTimes(1))
  })

  it('refuses to subscribe before there is a room to listen to', () => {
    const host = new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: HOST_UID } } as never,
    })

    expect(() => host.subscribe(() => undefined)).toThrow(/no room code/)
    expect(onSnapshotMock).not.toHaveBeenCalled()
  })
})

describe('FirestoreGameRepository invites', () => {
  const GUEST_ID = 'guest-3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'
  const JUHO_UID = 'juho-uid'
  const INVITE_PATH = `invites/${ROOM_CODE}_${GUEST_ID}`

  function hostRepository(roomCode: string | undefined = ROOM_CODE) {
    return new FirestoreGameRepository({
      db: {} as never,
      auth: { currentUser: { uid: HOST_UID } } as never,
      roomCode,
      now: () => 1234,
      newGuestId: () => GUEST_ID.slice('guest-'.length),
      generateRoomCode: () => 'FGHJK',
    })
  }

  function batchWrites(): [string, unknown][] {
    return batchSetMock.mock.calls.map(([ref, data]) => [(ref as { path: string }).path, data])
  }

  function hostSeatIs(name: string) {
    getDocMock.mockImplementation((ref: { path: string }) =>
      Promise.resolve(
        ref.path.endsWith(`/players/${HOST_UID}`)
          ? snapshot({ name, ownerUid: HOST_UID })
          : snapshot(undefined),
      ),
    )
  }

  it('invites the owner of a claimed name, with the seat, naming the host', async () => {
    readNameClaimMock.mockResolvedValue({ name: 'Juho', ownerUid: JUHO_UID })
    hostSeatIs('Host')

    await hostRepository().addGuest({ name: 'Juho' })

    expect(batchWrites()).toEqual([
      [
        `room/${ROOM_CODE}/players/${GUEST_ID}`,
        expect.objectContaining({ name: 'Juho', isGuest: true, invitedUid: JUHO_UID }),
      ],
      [`room/${ROOM_CODE}/names/n_juho`, { ownerUid: HOST_UID, playerId: GUEST_ID }],
      [
        INVITE_PATH,
        {
          gameId: ROOM_CODE,
          guestId: GUEST_ID,
          invitedUid: JUHO_UID,
          hostUid: HOST_UID,
          hostName: 'Host',
          name: 'Juho',
          status: 'pending',
          createdAt: 'server-time',
        },
      ],
    ])
  })

  it("seats a plain guest under a name nobody claimed, or the host's own", async () => {
    await hostRepository().addGuest({ name: 'Mummo' })
    readNameClaimMock.mockResolvedValue({ name: 'Host', ownerUid: HOST_UID })
    await hostRepository().addGuest({ name: 'Hostname' })

    expect(batchWrites().map(([path]) => path)).not.toContain(INVITE_PATH)
    expect(batchWrites()[0]?.[1]).not.toHaveProperty('invitedUid')
  })

  it("deletes an invited seat's invite with the seat", async () => {
    getDocMock.mockResolvedValue(
      snapshot({ name: 'Juho', ownerUid: HOST_UID, isGuest: true, invitedUid: JUHO_UID }),
    )

    await hostRepository().removePlayer(GUEST_ID)

    expect(batchDeleteMock).toHaveBeenCalledWith({ path: INVITE_PATH })
  })

  it('lets the invited player read the finished game, and leaves the public lists to them', async () => {
    getDocsMock.mockImplementation((ref: { path: string }) => {
      if (ref.path === `room/${ROOM_CODE}/players`) {
        return Promise.resolve({
          docs: [
            playerDoc(HOST_UID, 'Host', 'device-host'),
            {
              id: GUEST_ID,
              data: () => ({
                name: 'Juho',
                ownerUid: HOST_UID,
                deviceUuid: GUEST_ID,
                totalScore: 0,
                joinOrder: 1,
                isGuest: true,
                invitedUid: JUHO_UID,
              }),
            },
          ],
        })
      }
      return Promise.resolve({
        docs: [1, 2, 3, 4, 5].flatMap((round) => [
          roundScoreDoc(HOST_UID, round, 10),
          roundScoreDoc(GUEST_ID, round, round === 1 ? 20 : 0),
        ]),
      })
    })
    getDocMock.mockResolvedValue(snapshot({ status: 'playing', currentRound: 5 }))

    await hostRepository().finishGame()

    expect(writeGameResultMock.mock.calls[0]?.[3]).toEqual([JUHO_UID])
    const published = publishHighscoresMock.mock.calls[0]?.[2] as GamePlayer[]
    expect(published.map((row) => row.deviceUuid)).toEqual([HOST_UID])
  })

  describe('Play again', () => {
    const invitedSeat = {
      id: GUEST_ID,
      data: () => ({
        name: 'Juho',
        ownerUid: HOST_UID,
        deviceUuid: GUEST_ID,
        totalScore: 20,
        joinOrder: 3,
        isGuest: true,
        invitedUid: JUHO_UID,
      }),
    }

    /** `firstCarryFails`: how the carried seat's first batch fails, if it does. */
    async function carryInvitedSeat(firstCarryFails?: Error) {
      const repo = hostRepository(undefined)
      await repo.createNextGame({ hostDeviceUuid: 'd', hostDisplayName: 'Host' }, ROOM_CODE)
      if (firstCarryFails) batchCommitMock.mockRejectedValueOnce(firstCarryFails)
      batchCommitMock.mockClear()
      batchSetMock.mockClear()
      getDocsMock.mockResolvedValue({ docs: [invitedSeat] })
      hostSeatIs('Host')
      await repo.carrySeats()
    }

    it('invites the player to the next game as well', async () => {
      await carryInvitedSeat()

      expect(batchWrites()).toContainEqual([
        `invites/FGHJK_${GUEST_ID}`,
        expect.objectContaining({ gameId: 'FGHJK', invitedUid: JUHO_UID, hostName: 'Host' }),
      ])
    })

    it("carries a plain guest when the invite is refused, as when the name's claim moved", async () => {
      await carryInvitedSeat(permissionDenied)

      const lastSeat = batchWrites()
        .filter(([path]) => path.endsWith(`/players/${GUEST_ID}`))
        .at(-1)
      expect(lastSeat?.[1]).not.toHaveProperty('invitedUid')
      expect(batchCommitMock).toHaveBeenCalledTimes(2)
    })

    it('passes on any other failure of an invited seat', async () => {
      await carryInvitedSeat(unavailable)

      expect(batchCommitMock).toHaveBeenCalledTimes(1)
    })
  })
})
