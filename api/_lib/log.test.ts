// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { logServerError } from './log'

let consoleError: MockInstance<typeof console.error>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('logServerError', () => {
  it("logs the stage with the error's name and message", () => {
    logServerError('gemini call', new TypeError('fetch failed'))

    expect(consoleError).toHaveBeenCalledWith(
      '[api/count] gemini call failed: TypeError: fetch failed',
    )
  })

  it('logs a thrown non-Error value as its string form', () => {
    logServerError('request', 'socket hang up')

    expect(consoleError).toHaveBeenCalledWith('[api/count] request failed: socket hang up')
  })

  it('logs only the summary, not the error object with its stack or attached fields', () => {
    const error = Object.assign(new Error('bad'), { idToken: 'secret-token' })

    logServerError('request', error)

    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0]).toEqual(['[api/count] request failed: Error: bad'])
  })
})
