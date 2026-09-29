import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase/firestore'

const docs = new Map<string, Record<string, unknown>>()
const commit = vi.fn()
const batchSets: [string, Record<string, unknown>][] = []
const batchDeletes: string[] = []

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  getDoc: (path: string) =>
    Promise.resolve({ exists: () => docs.has(path), data: () => docs.get(path) }),
  writeBatch: () => ({
    set: (path: string, data: Record<string, unknown>) => batchSets.push([path, data]),
    delete: (path: string) => batchDeletes.push(path),
    commit: () => commit(),
  }),
}))

const { claimName, readNameClaim, readOwnClaim } = await import('./name-claims')

const db = {} as Firestore

beforeEach(() => {
  docs.clear()
  batchSets.length = 0
  batchDeletes.length = 0
  vi.clearAllMocks()
  commit.mockResolvedValue(undefined)
})

describe('readNameClaim', () => {
  it("reads the claim under the name's key, ignoring case and spaces", async () => {
    docs.set('claimedNames/n_juho', { name: 'Juho', ownerUid: 'uid-juho' })

    expect(await readNameClaim(db, ' JUHO ')).toEqual({ name: 'Juho', ownerUid: 'uid-juho' })
    expect(await readNameClaim(db, 'Ripa')).toBeNull()
  })
})

describe('readOwnClaim', () => {
  it("is the account's claimed name, or null without one", async () => {
    expect(await readOwnClaim(db, 'uid-juho')).toBeNull()

    docs.set('claimOwners/uid-juho', { nameKey: 'n_juho' })
    docs.set('claimedNames/n_juho', { name: 'Juho', ownerUid: 'uid-juho' })
    expect(await readOwnClaim(db, 'uid-juho')).toBe('Juho')
  })

  it('is null when the owner released only the claim', async () => {
    docs.set('claimOwners/uid-juho', { nameKey: 'n_juho' })

    expect(await readOwnClaim(db, 'uid-juho')).toBeNull()
  })
})

describe('claimName', () => {
  it('writes the clean name and its owner doc in one batch', async () => {
    expect(await claimName(db, 'uid-juho', '  Juho  ')).toBe('claimed')

    expect(batchSets).toEqual([
      ['claimOwners/uid-juho', { nameKey: 'n_juho' }],
      ['claimedNames/n_juho', { name: 'Juho', ownerUid: 'uid-juho' }],
    ])
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it("says taken for someone else's claim, and claimed for one's own, without writing", async () => {
    docs.set('claimedNames/n_juho', { name: 'Juho', ownerUid: 'uid-juho' })

    expect(await claimName(db, 'uid-other', 'juho')).toBe('taken')
    expect(await claimName(db, 'uid-juho', 'Juho')).toBe('claimed')
    expect(commit).not.toHaveBeenCalled()
  })

  it('says taken when someone claimed it between the read and the write', async () => {
    commit.mockImplementation(() => {
      docs.set('claimedNames/n_juho', { name: 'Juho', ownerUid: 'uid-other' })
      return Promise.reject(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    })

    expect(await claimName(db, 'uid-juho', 'Juho')).toBe('taken')
  })

  it('rethrows a refusal it cannot explain, and any other failure', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'permission-denied' })
    commit.mockRejectedValue(denied)
    await expect(claimName(db, 'uid-juho', 'Juho')).rejects.toBe(denied)

    const offline = Object.assign(new Error('offline'), { code: 'unavailable' })
    commit.mockRejectedValue(offline)
    await expect(claimName(db, 'uid-juho', 'Juho')).rejects.toBe(offline)
  })

  it("moves the account's claim to the new name, freeing the old one in the same batch", async () => {
    docs.set('claimOwners/uid-juho', { nameKey: 'n_juho' })
    docs.set('claimedNames/n_juho', { name: 'Juho', ownerUid: 'uid-juho' })

    expect(await claimName(db, 'uid-juho', 'Jussi')).toBe('claimed')

    expect(batchSets).toEqual([
      ['claimOwners/uid-juho', { nameKey: 'n_jussi' }],
      ['claimedNames/n_jussi', { name: 'Jussi', ownerUid: 'uid-juho' }],
    ])
    expect(batchDeletes).toEqual(['claimedNames/n_juho'])
  })

  it('deletes nothing when the console already released the old claim', async () => {
    docs.set('claimOwners/uid-juho', { nameKey: 'n_juho' })

    expect(await claimName(db, 'uid-juho', 'Jussi')).toBe('claimed')

    expect(batchDeletes).toEqual([])
  })
})
