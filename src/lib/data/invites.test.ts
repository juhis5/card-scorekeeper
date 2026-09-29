import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase/firestore'

const docs = new Map<string, Record<string, unknown>>()
const updateDoc = vi.fn()
const commit = vi.fn()
const batchOps: [string, string, unknown][] = []
let snapshotListener: ((snapshot: unknown) => void) | null = null
let errorListener: ((error: unknown) => void) | null = null
const queries: unknown[] = []

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  getDoc: (path: string) =>
    Promise.resolve({
      id: path.split('/')[1],
      exists: () => docs.has(path),
      data: () => docs.get(path),
    }),
  onSnapshot: (
    query: unknown,
    onNext: (snapshot: unknown) => void,
    onError: (error: unknown) => void,
  ) => {
    queries.push(query)
    snapshotListener = onNext
    errorListener = onError
    return () => undefined
  },
  query: (...parts: unknown[]) => parts,
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  updateDoc: (path: string, data: unknown) => updateDoc(path, data),
  writeBatch: () => ({
    set: (path: string, data: unknown) => batchOps.push(['set', path, data]),
    update: (path: string, data: unknown) => batchOps.push(['update', path, data]),
    commit: () => commit(),
  }),
}))

const { answerInvite, countInvite, readInvite, readInviteGame, watchInvites } =
  await import('./invites')

const db = {} as Firestore
const at = (ms: number) => ({ toMillis: () => ms })

function inviteData(overrides: Record<string, unknown> = {}) {
  return {
    gameId: 'ABCDE',
    guestId: 'guest-1',
    invitedUid: 'uid-juho',
    hostName: 'Host',
    name: 'Juho',
    status: 'pending',
    createdAt: at(1000),
    ...overrides,
  }
}

beforeEach(() => {
  docs.clear()
  batchOps.length = 0
  queries.length = 0
  vi.clearAllMocks()
  commit.mockResolvedValue(undefined)
  updateDoc.mockResolvedValue(undefined)
})

describe('watchInvites', () => {
  it("follows this player's open invites, newest first, unstamped ones on top", () => {
    const onChange = vi.fn()
    const onError = vi.fn()
    watchInvites(db, 'uid-juho', onChange, onError)

    expect(queries[0]).toEqual([
      { path: 'invites' },
      { field: 'invitedUid', op: '==', value: 'uid-juho' },
      { field: 'status', op: 'in', value: ['pending', 'accepted'] },
    ])
    snapshotListener?.({
      docs: [
        { id: 'OLD_guest-1', data: () => inviteData({ createdAt: at(1000) }) },
        { id: 'NEW_guest-2', data: () => inviteData({ createdAt: at(5000) }) },
        { id: 'NOW_guest-3', data: () => inviteData({ createdAt: null }) },
        { id: 'NOW_guest-4', data: () => inviteData({ createdAt: null }) },
      ],
    })
    const order = onChange.mock.calls[0]?.[0].map((invite: { id: string }) => invite.id)
    expect(order.slice(2)).toEqual(['NEW_guest-2', 'OLD_guest-1'])
    expect(order.slice(0, 2).sort()).toEqual(['NOW_guest-3', 'NOW_guest-4'])

    errorListener?.(new Error('denied'))
    expect(onError).toHaveBeenCalled()
  })
})

describe('readInvite', () => {
  it('reads one invite, or null when it is gone', async () => {
    docs.set('invites/ABCDE_guest-1', inviteData())

    expect(await readInvite(db, 'ABCDE_guest-1')).toEqual({
      id: 'ABCDE_guest-1',
      gameId: 'ABCDE',
      guestId: 'guest-1',
      hostName: 'Host',
      name: 'Juho',
      status: 'pending',
      createdAt: 1000,
    })
    expect(await readInvite(db, 'ZZZZZ_guest-9')).toBeNull()
  })
})

describe('readInviteGame', () => {
  const NOW = 10_000

  it('tells a finished game, a running one, and one that ended without a result', async () => {
    docs.set('room/FINIS', { status: 'finished', expiresAt: at(0) })
    docs.set('room/PLAYS', { status: 'playing', expiresAt: at(NOW + 1) })
    docs.set('room/ABAND', { status: 'abandoned', expiresAt: at(NOW + 1) })
    docs.set('room/EXPIR', { status: 'playing', expiresAt: at(NOW) })

    expect(await readInviteGame(db, 'FINIS', NOW)).toBe('finished')
    expect(await readInviteGame(db, 'PLAYS', NOW)).toBe('running')
    expect(await readInviteGame(db, 'ABAND', NOW)).toBe('ended')
    expect(await readInviteGame(db, 'EXPIR', NOW)).toBe('ended')
    expect(await readInviteGame(db, 'GONE0', NOW)).toBe('ended')
    expect(await readInviteGame(db, 'PLAYS')).toBe('ended')
  })
})

describe('answerInvite', () => {
  it('sets only the status', async () => {
    await answerInvite(db, 'ABCDE_guest-1', 'declined')

    expect(updateDoc).toHaveBeenCalledWith('invites/ABCDE_guest-1', { status: 'declined' })
  })
})

describe('countInvite', () => {
  const invite = { id: 'ABCDE_guest-1', gameId: 'ABCDE', guestId: 'guest-1' }

  it("writes the guest's result as the player's, with the invite counted, in one batch", async () => {
    docs.set('game_player/ABCDE_guest-1', {
      gameId: 'ABCDE',
      deviceUuid: 'guest-1',
      participantUids: ['uid-host', 'guest-1', 'uid-juho'],
      displayName: 'Juho',
      finalScore: 35,
      placement: 1,
      bestRound: 0,
      worstRound: 20,
    })
    docs.set('game_result/ABCDE', {
      gameId: 'ABCDE',
      finishedAt: '2026-09-29T20:00:00.000Z',
      totalRounds: 5,
      participantUids: [],
    })

    const counted = await countInvite(db, 'uid-juho', invite)

    const row = {
      gameId: 'ABCDE',
      deviceUuid: 'uid-juho',
      displayName: 'Juho',
      finalScore: 35,
      placement: 1,
      bestRound: 0,
      worstRound: 20,
      replacesGuestId: 'guest-1',
    }
    expect(batchOps).toEqual([
      [
        'set',
        'game_player/ABCDE_uid-juho',
        { ...row, participantUids: ['uid-host', 'guest-1', 'uid-juho'] },
      ],
      ['update', 'invites/ABCDE_guest-1', { status: 'counted' }],
    ])
    expect(counted).toEqual({
      result: { gameId: 'ABCDE', finishedAt: '2026-09-29T20:00:00.000Z', totalRounds: 5 },
      row,
    })
  })

  it('counts nothing before the game has a result', async () => {
    expect(await countInvite(db, 'uid-juho', invite)).toBeNull()
    expect(commit).not.toHaveBeenCalled()
  })
})
