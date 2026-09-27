import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withTimeout } from './timeout'
import { isPermanentWriteError } from './write-errors'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    const result = withTimeout(Promise.resolve('done'), 1000)

    await expect(result).resolves.toBe('done')
  })

  it('rejects with a deadline-exceeded error when the promise never settles', async () => {
    const result = withTimeout(new Promise(() => undefined), 1000)
    const assertion = await expect(result).rejects.toMatchObject({ code: 'deadline-exceeded' })

    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('reports a timeout as transient, so callers retry or fall back rather than give up', async () => {
    const result = withTimeout(new Promise(() => undefined), 10)
    const caught = result.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10)

    expect(isPermanentWriteError(await caught)).toBe(false)
  })

  it('passes a rejection through unchanged', async () => {
    const failure = new Error('denied')

    await expect(withTimeout(Promise.reject(failure), 1000)).rejects.toBe(failure)
  })
})
