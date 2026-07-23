import { describe, it, expect } from 'vitest'
import en from './en.json'
import fi from './fi.json'

/** All dotted leaf-key paths in a nested messages object, e.g. "home.heading". */
function leafKeyPaths(messages: object, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null ? leafKeyPaths(value, path) : [path]
  })
}

describe('locale messages', () => {
  it('defines the same keys in every locale', () => {
    const enKeys = leafKeyPaths(en).sort()
    const fiKeys = leafKeyPaths(fi).sort()

    expect(fiKeys).toEqual(enKeys)
  })
})
