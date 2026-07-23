import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('merges class lists and lets the later Tailwind class win a conflict', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('drops falsy values', () => {
    expect(cn('block', false, undefined, null, 'text-sm')).toBe('block text-sm')
  })
})
