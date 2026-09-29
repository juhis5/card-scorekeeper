import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACCEPTED_INVITES_STORAGE_KEY,
  forgetAcceptedInvite,
  readAcceptedInvites,
  rememberAcceptedInvite,
} from './accepted-invites'
import type { KeyValueStorage } from './key-value-storage'

let values: Map<string, string>
const storage: KeyValueStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => void values.set(key, value),
}

beforeEach(() => {
  values = new Map()
})

describe('accepted invites', () => {
  it('remembers each invite once, and forgets it', () => {
    rememberAcceptedInvite(storage, 'A_guest-1')
    rememberAcceptedInvite(storage, 'B_guest-2')
    rememberAcceptedInvite(storage, 'A_guest-1')
    expect(readAcceptedInvites(storage)).toEqual(['B_guest-2', 'A_guest-1'])

    forgetAcceptedInvite(storage, 'B_guest-2')
    expect(readAcceptedInvites(storage)).toEqual(['A_guest-1'])
  })

  it('reads bad data as none waiting, keeping only the ids', () => {
    values.set(ACCEPTED_INVITES_STORAGE_KEY, '{not json')
    expect(readAcceptedInvites(storage)).toEqual([])

    values.set(ACCEPTED_INVITES_STORAGE_KEY, JSON.stringify({ id: 'x' }))
    expect(readAcceptedInvites(storage)).toEqual([])

    values.set(ACCEPTED_INVITES_STORAGE_KEY, JSON.stringify(['A_guest-1', 7, null]))
    expect(readAcceptedInvites(storage)).toEqual(['A_guest-1'])
  })
})
