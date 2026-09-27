import { describe, it, expect } from 'vitest'
import en from './en.json'
import fi from './fi.json'
import { CONTRACTS } from '@/lib/game/rules'

/** All dotted leaf-key paths in a nested messages object, e.g. "home.heading". */
function leafKeyPaths(messages: object, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null ? leafKeyPaths(value, path) : [path]
  })
}

/** Resolves a dotted path (e.g. "contract.round1") to its value in a nested messages object. */
function resolvePath(messages: object, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      messages,
    )
}

describe('locale messages', () => {
  it('defines the same keys in every locale', () => {
    const enKeys = leafKeyPaths(en).sort()
    const fiKeys = leafKeyPaths(fi).sort()

    expect(fiKeys).toEqual(enKeys)
  })

  it('has a translated string for every contract key the rules define', () => {
    const contractKeys = CONTRACTS.map((contract) => contract.contractKey)

    expect(contractKeys.every((key) => typeof resolvePath(en, key) === 'string')).toBe(true)
    expect(contractKeys.every((key) => typeof resolvePath(fi, key) === 'string')).toBe(true)
  })
})
