import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { readAcceptedInvites, rememberAcceptedInvite } from '@/lib/data/accepted-invites'
import { readPendingHighscores } from '@/lib/data/pending-results'
import type { Invite } from '@/lib/data/invites'

const ensureSignedIn = vi.fn()
const reportHandledError = vi.fn()
const readInviteGame = vi.fn()
const countInvite = vi.fn()
const answerInvite = vi.fn()
const countPendingInvites = vi.fn()
const publishHighscores = vi.fn()
const unsubscribe = vi.fn()
let emitInvites: (invites: Invite[]) => void = () => {}
let failWatch: (error: unknown) => void = () => {}

vi.mock('@/lib/data/firebase', () => ({
  getDb: () => 'db',
  ensureSignedIn: () => ensureSignedIn(),
}))
vi.mock('@/lib/data/invites', () => ({
  watchInvites: (
    _db: unknown,
    _uid: string,
    onChange: (invites: Invite[]) => void,
    onError: (error: unknown) => void,
  ) => {
    emitInvites = onChange
    failWatch = onError
    return unsubscribe
  },
  readInviteGame: (...args: unknown[]) => readInviteGame(...args),
  countInvite: (...args: unknown[]) => countInvite(...args),
  answerInvite: (...args: unknown[]) => answerInvite(...args),
  countPendingInvites: (...args: unknown[]) => countPendingInvites(...args),
}))
vi.mock('@/lib/data/firestore-stats', () => ({
  publishHighscores: (...args: unknown[]) => publishHighscores(...args),
}))
vi.mock('@/lib/platform/error-reporting', () => ({
  reportHandledError: (...args: unknown[]) => reportHandledError(...args),
}))

const { useInvitesStore } = await import('./invites')

const offline = Object.assign(new Error('offline'), { code: 'unavailable' })

function invite(id: string, overrides: Partial<Invite> = {}): Invite {
  return {
    id,
    gameId: id.split('_')[0] ?? id,
    guestId: 'guest-1',
    hostName: 'Host',
    name: 'Juho',
    status: 'pending',
    createdAt: 1000,
    ...overrides,
  }
}

const counted = {
  result: { gameId: 'FINIS', finishedAt: 'x', totalRounds: 5 },
  row: {
    gameId: 'FINIS',
    deviceUuid: 'uid-juho',
    displayName: 'Juho',
    finalScore: 20,
    placement: 1,
    bestRound: 0,
    worstRound: 5,
    replacesGuestId: 'guest-1',
  },
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  ensureSignedIn.mockResolvedValue('uid-juho')
  readInviteGame.mockImplementation((_db: unknown, gameId: string) =>
    Promise.resolve(gameId === 'FINIS' ? 'finished' : gameId === 'ENDED' ? 'ended' : 'running'),
  )
  answerInvite.mockResolvedValue(undefined)
  countInvite.mockResolvedValue(counted)
  publishHighscores.mockResolvedValue([])
})

async function started(invites: Invite[]) {
  const store = useInvitesStore()
  await store.start()
  emitInvites(invites)
  await flushPromises()
  return store
}

describe('useInvitesStore', () => {
  it('follows the open invites, each with where its game stands', async () => {
    const store = useInvitesStore()
    expect(store.status).toBe('idle')

    await started([invite('FINIS_guest-1'), invite('PLAYS_guest-1'), invite('ENDED_guest-1')])

    expect(store.status).toBe('ready')
    expect(store.invites.map((view) => [view.id, view.game])).toEqual([
      ['FINIS_guest-1', 'finished'],
      ['PLAYS_guest-1', 'running'],
      ['ENDED_guest-1', 'ended'],
    ])
    expect(readInviteGame).toHaveBeenCalledTimes(3)
  })

  it('reads each game once, and shows an invite whose game could not be read', async () => {
    readInviteGame.mockRejectedValueOnce(offline).mockRejectedValueOnce(new Error('broken'))
    const store = await started([invite('PLAYS_guest-1'), invite('OTHER_guest-1')])
    expect(store.invites.map((view) => view.game)).toEqual([null, null])
    expect(reportHandledError).toHaveBeenCalledTimes(1)

    emitInvites([invite('PLAYS_guest-1')])
    await flushPromises()
    expect(store.invites[0]?.game).toBe('running')
    emitInvites([invite('PLAYS_guest-1', { status: 'accepted' })])
    await flushPromises()
    expect(readInviteGame).toHaveBeenCalledTimes(3)
  })

  it('starts once, and stops following', async () => {
    const store = await started([invite('PLAYS_guest-1')])
    await store.start()

    store.stop()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(store.invites).toEqual([])
    expect(store.status).toBe('idle')
  })

  it('lands on error when it cannot start or the watch fails, reporting real failures', async () => {
    ensureSignedIn.mockRejectedValueOnce(offline)
    const store = useInvitesStore()
    await store.start()
    expect(store.status).toBe('error')
    expect(reportHandledError).not.toHaveBeenCalled()

    ensureSignedIn.mockRejectedValueOnce(new Error('broken'))
    await store.start()
    expect(reportHandledError).toHaveBeenCalledWith(expect.any(Error), 'start-invites')

    await store.start()
    failWatch(offline)
    expect(store.status).toBe('error')
    failWatch(new Error('denied'))
    expect(reportHandledError).toHaveBeenCalledWith(expect.any(Error), 'watch-invites')
  })

  it('counts a finished game at once and publishes it', async () => {
    const store = await started([invite('FINIS_guest-1')])
    rememberAcceptedInvite(localStorage, 'FINIS_guest-1')
    const [finished] = store.invites
    if (!finished) throw new Error('expected an invite')

    await store.accept(finished)

    expect(countInvite).toHaveBeenCalledWith('db', 'uid-juho', finished)
    expect(publishHighscores).toHaveBeenCalledWith('db', counted.result, [counted.row])
    expect(answerInvite).not.toHaveBeenCalled()
    expect(readAcceptedInvites(localStorage)).toEqual([])
    expect(store.notice).toBe('counted')
    expect(store.busyInviteId).toBeNull()
  })

  it('queues a public entry that failed to publish', async () => {
    publishHighscores.mockResolvedValue([counted.row])
    const store = await started([invite('FINIS_guest-1')])

    await store.accept(store.invites[0] as never)

    expect(readPendingHighscores(localStorage)).toEqual([
      { result: counted.result, players: [counted.row] },
    ])
  })

  it('accepts a running game to count later, and a finished one whose result has not landed', async () => {
    countInvite.mockResolvedValue(null)
    const store = await started([invite('PLAYS_guest-1'), invite('FINIS_guest-1')])

    await store.accept(store.invites[0] as never)
    await store.accept(store.invites[1] as never)

    expect(answerInvite).toHaveBeenCalledWith('db', 'PLAYS_guest-1', 'accepted')
    expect(answerInvite).toHaveBeenCalledWith('db', 'FINIS_guest-1', 'accepted')
    expect(readAcceptedInvites(localStorage)).toEqual(['PLAYS_guest-1', 'FINIS_guest-1'])
    expect(store.notice).toBe('accepted')
  })

  it('does not answer an already accepted invite again', async () => {
    const store = await started([invite('PLAYS_guest-1', { status: 'accepted' })])

    await store.accept(store.invites[0] as never)

    expect(answerInvite).not.toHaveBeenCalled()
  })

  it('declines, forgetting an accepted one', async () => {
    rememberAcceptedInvite(localStorage, 'PLAYS_guest-1')
    const store = await started([invite('PLAYS_guest-1', { status: 'accepted' })])

    await store.decline(store.invites[0] as never)

    expect(answerInvite).toHaveBeenCalledWith('db', 'PLAYS_guest-1', 'declined')
    expect(readAcceptedInvites(localStorage)).toEqual([])
    expect(store.notice).toBe('declined')
  })

  it('says offline or failed, reporting only the failure', async () => {
    const store = await started([invite('PLAYS_guest-1')])
    answerInvite.mockRejectedValueOnce(offline)
    await store.decline(store.invites[0] as never)
    expect(store.notice).toBe('offline')
    expect(reportHandledError).not.toHaveBeenCalled()

    answerInvite.mockRejectedValueOnce(new Error('broken'))
    await store.decline(store.invites[0] as never)
    expect(store.notice).toBe('failed')
    expect(reportHandledError).toHaveBeenCalledWith(expect.any(Error), 'answer-invite')
  })

  it('answers one invite at a time, and nothing before it has started', async () => {
    const idle = useInvitesStore()
    await idle.accept(invite('PLAYS_guest-1') as never)
    expect(answerInvite).not.toHaveBeenCalled()

    const store = await started([invite('PLAYS_guest-1')])
    answerInvite.mockReturnValueOnce(new Promise(() => {}))
    void store.accept(store.invites[0] as never)
    await store.decline(store.invites[0] as never)
    expect(answerInvite).toHaveBeenCalledTimes(1)
  })

  it('accepts every pending invite that can still count, in turn, stopping at a failure', async () => {
    const store = await started([
      invite('FINIS_guest-1'),
      invite('PLAYS_guest-1'),
      invite('ENDED_guest-1'),
      invite('OTHER_guest-1', { status: 'accepted' }),
    ])

    await store.acceptAll()
    expect(countInvite).toHaveBeenCalledTimes(1)
    expect(answerInvite).toHaveBeenCalledTimes(1)
    expect(answerInvite).toHaveBeenCalledWith('db', 'PLAYS_guest-1', 'accepted')

    vi.clearAllMocks()
    countInvite.mockRejectedValueOnce(offline)
    await store.acceptAll()
    expect(answerInvite).not.toHaveBeenCalled()
  })

  it('counts the invites waiting for an answer, as none when it cannot', async () => {
    countPendingInvites.mockResolvedValueOnce(2)
    const store = useInvitesStore()
    await store.loadPendingCount()
    expect(countPendingInvites).toHaveBeenCalledWith('db', 'uid-juho')
    expect(store.pendingCount).toBe(2)

    countPendingInvites.mockRejectedValueOnce(offline)
    await store.loadPendingCount()
    expect(store.pendingCount).toBe(0)
    expect(reportHandledError).not.toHaveBeenCalled()

    countPendingInvites.mockRejectedValueOnce(new Error('broken'))
    await store.loadPendingCount()
    expect(reportHandledError).toHaveBeenCalledWith(expect.any(Error), 'count-pending-invites')
  })
})
