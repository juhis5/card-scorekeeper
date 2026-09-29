import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'

const readNameClaim = vi.fn()
const ensureSignedIn = vi.fn()
const reportHandledError = vi.fn()

vi.mock('@/lib/data/firebase', () => ({
  getDb: () => 'db',
  ensureSignedIn: () => ensureSignedIn(),
}))
vi.mock('@/lib/data/name-claims', () => ({
  readNameClaim: (...args: unknown[]) => readNameClaim(...args),
}))
vi.mock('@/lib/platform/error-reporting', () => ({
  reportHandledError: (...args: unknown[]) => reportHandledError(...args),
}))

const { forgetClaims, rememberClaim, useClaimedNames } = await import('./useClaimedNames')
type NamedPlayer = import('./useClaimedNames').NamedPlayer

const OWNERS: Record<string, string> = { Juho: 'uid-juho', Ripa: 'uid-ripa' }

beforeEach(() => {
  vi.clearAllMocks()
  forgetClaims()
  ensureSignedIn.mockResolvedValue('uid-me')
  readNameClaim.mockImplementation((_db: unknown, name: string) => {
    const ownerUid = OWNERS[name]
    return Promise.resolve(ownerUid ? { name, ownerUid } : null)
  })
})

function start(players: () => readonly NamedPlayer[]) {
  const scope = effectScope()
  const claimed = scope.run(() => useClaimedNames(players))
  if (!claimed) throw new Error('expected the composable to run')
  return claimed
}

describe('useClaimedNames', () => {
  it("marks only players shown under their own claimed name, not a namesake's or a guest's", async () => {
    const claimed = start(() => [
      { playerId: 'uid-juho', name: 'Juho' },
      { playerId: 'guest-1', name: 'Ripa' },
      { playerId: 'uid-other', name: 'Mari' },
    ])
    await flushPromises()

    expect([...claimed.value]).toEqual(['uid-juho'])
  })

  it('reads a name once per session, and nothing for an empty list', async () => {
    start(() => [])
    await flushPromises()
    expect(readNameClaim).not.toHaveBeenCalled()

    start(() => [{ playerId: 'uid-juho', name: 'Juho' }])
    start(() => [{ playerId: 'uid-juho', name: 'JUHO' }])
    await flushPromises()

    expect(readNameClaim).toHaveBeenCalledTimes(1)
    expect(ensureSignedIn).toHaveBeenCalledTimes(1)
  })

  it('follows a changed list, but not a new array of the same players', async () => {
    const players = ref<NamedPlayer[]>([{ playerId: 'uid-other', name: 'Mari' }])
    const claimed = start(() => players.value)
    await flushPromises()
    expect(claimed.value.size).toBe(0)
    const before = claimed.value

    players.value = [{ playerId: 'uid-other', name: 'Mari' }]
    await nextTick()
    await flushPromises()
    expect(claimed.value).toBe(before)

    players.value = [...players.value, { playerId: 'uid-ripa', name: 'Ripa' }]
    await nextTick()
    await flushPromises()
    expect([...claimed.value]).toEqual(['uid-ripa'])
  })

  it('keeps only the newest list when an older read lands late', async () => {
    let finishJuho: (claim: unknown) => void = () => {}
    readNameClaim.mockImplementationOnce(() => new Promise((resolve) => (finishJuho = resolve)))
    const players = ref<NamedPlayer[]>([{ playerId: 'uid-juho', name: 'Juho' }])
    const claimed = start(() => players.value)
    await flushPromises()

    players.value = [{ playerId: 'uid-ripa', name: 'Ripa' }]
    await nextTick()
    await flushPromises()
    finishJuho({ name: 'Juho', ownerUid: 'uid-juho' })
    await flushPromises()

    expect([...claimed.value]).toEqual(['uid-ripa'])
  })

  it('shows a claim this device just made without reading it', async () => {
    rememberClaim('Mari', 'uid-me')
    const claimed = start(() => [{ playerId: 'uid-me', name: 'mari' }])
    await flushPromises()

    expect([...claimed.value]).toEqual(['uid-me'])
    expect(readNameClaim).not.toHaveBeenCalled()
  })

  it('shows no badge when a read fails, asks again next time, and reports only real failures', async () => {
    readNameClaim.mockRejectedValueOnce(
      Object.assign(new Error('offline'), { code: 'unavailable' }),
    )
    const first = start(() => [{ playerId: 'uid-juho', name: 'Juho' }])
    await flushPromises()
    expect(first.value.size).toBe(0)
    expect(reportHandledError).not.toHaveBeenCalled()

    const broken = new Error('broken')
    readNameClaim.mockRejectedValueOnce(broken)
    start(() => [{ playerId: 'uid-juho', name: 'Juho' }])
    await flushPromises()
    expect(reportHandledError).toHaveBeenCalledWith(broken, 'read-name-claim')

    const third = start(() => [{ playerId: 'uid-juho', name: 'Juho' }])
    await flushPromises()
    expect([...third.value]).toEqual(['uid-juho'])
  })

  it('signs in again after a failed sign-in', async () => {
    ensureSignedIn.mockRejectedValueOnce(
      Object.assign(new Error('offline'), { code: 'unavailable' }),
    )
    const first = start(() => [{ playerId: 'uid-juho', name: 'Juho' }])
    await flushPromises()
    expect(first.value.size).toBe(0)

    const second = start(() => [{ playerId: 'uid-juho', name: 'Juho' }])
    await flushPromises()

    expect(ensureSignedIn).toHaveBeenCalledTimes(2)
    expect([...second.value]).toEqual(['uid-juho'])
  })
})
