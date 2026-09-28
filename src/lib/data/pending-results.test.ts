import { describe, expect, it, vi } from 'vitest'
import {
  appendPendingResult,
  FAILED_RESULTS_STORAGE_KEY,
  flushPendingResults,
  PENDING_RESULTS_STORAGE_KEY,
  readPendingResults,
} from './pending-results'
import type { PendingResult, PendingResultWriter } from './pending-results'
import type { KeyValueStorage } from './key-value-storage'

function makeMemoryStorage(): KeyValueStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

/** A storage whose writes always fail, like iOS Safari private mode's zero quota. */
function makeThrowingStorage(): KeyValueStorage {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
}

function pendingResult(gameId: string, deviceUuid = 'device-a'): PendingResult {
  return {
    result: {
      gameId,
      finishedAt: '2026-01-01T00:00:00.000Z',
      totalRounds: 5,
    },
    players: [
      {
        gameId,
        deviceUuid,
        displayName: 'Alice',
        finalScore: 42,
        placement: 1,
        bestRound: 5,
        worstRound: 20,
      },
    ],
  }
}

describe('readPendingResults', () => {
  it('returns an empty array when nothing has been queued', () => {
    expect(readPendingResults(makeMemoryStorage())).toEqual([])
  })

  it('returns an empty array instead of crashing on corrupted JSON under the key', () => {
    const storage = makeMemoryStorage()
    storage.setItem(PENDING_RESULTS_STORAGE_KEY, '{not json')

    expect(readPendingResults(storage)).toEqual([])
  })

  it('drops malformed entries mixed into an otherwise-valid stored array', () => {
    const storage = makeMemoryStorage()
    const valid = pendingResult('g1')
    storage.setItem(PENDING_RESULTS_STORAGE_KEY, JSON.stringify([valid, { garbage: true }, null]))

    expect(readPendingResults(storage)).toEqual([valid])
  })
})

describe('appendPendingResult', () => {
  it('queues an entry that readPendingResults then returns', () => {
    const storage = makeMemoryStorage()
    const entry = pendingResult('g1')

    appendPendingResult(storage, entry)

    expect(readPendingResults(storage)).toEqual([entry])
  })

  it('accumulates multiple entries in append order', () => {
    const storage = makeMemoryStorage()
    appendPendingResult(storage, pendingResult('g1'))
    appendPendingResult(storage, pendingResult('g2'))

    expect(readPendingResults(storage).map((entry) => entry.result.gameId)).toEqual(['g1', 'g2'])
  })

  it('does not throw when storage writes fail', () => {
    const storage = makeThrowingStorage()

    expect(() => appendPendingResult(storage, pendingResult('g1'))).not.toThrow()
  })
})

describe('flushPendingResults', () => {
  function writerThat(behavior: (entry: PendingResult) => Promise<void>): PendingResultWriter {
    return { write: vi.fn(behavior) }
  }

  it('never calls the writer and reports nothing flushed when the queue is empty', async () => {
    const storage = makeMemoryStorage()
    const writer = writerThat(() => Promise.resolve())

    const summary = await flushPendingResults(storage, writer)

    expect(summary).toEqual({ flushed: 0, failed: 0, remaining: 0 })
    expect(writer.write).not.toHaveBeenCalled()
  })

  it('clears the queue after every entry writes successfully', async () => {
    const storage = makeMemoryStorage()
    appendPendingResult(storage, pendingResult('g1'))
    appendPendingResult(storage, pendingResult('g2'))
    const writer = writerThat(() => Promise.resolve())

    const summary = await flushPendingResults(storage, writer)

    expect(summary).toEqual({ flushed: 2, failed: 0, remaining: 0 })
    expect(readPendingResults(storage)).toEqual([])
  })

  it('leaves a failing entry queued for the next attempt instead of dropping it', async () => {
    const storage = makeMemoryStorage()
    const failing = pendingResult('g1')
    appendPendingResult(storage, failing)
    const writer = writerThat(() => Promise.reject(new Error('offline')))

    const summary = await flushPendingResults(storage, writer)

    expect(summary).toEqual({ flushed: 0, failed: 0, remaining: 1 })
    expect(readPendingResults(storage)).toEqual([failing])
  })

  it('writes entries in queue order, keeping only the first failure and everything after it queued', async () => {
    const storage = makeMemoryStorage()
    const [first, second, third] = [pendingResult('g1'), pendingResult('g2'), pendingResult('g3')]
    appendPendingResult(storage, first)
    appendPendingResult(storage, second)
    appendPendingResult(storage, third)
    const seen: string[] = []
    const writer = writerThat((entry) => {
      seen.push(entry.result.gameId)
      if (entry.result.gameId === 'g2') return Promise.reject(new Error('offline again'))
      return Promise.resolve()
    })

    const summary = await flushPendingResults(storage, writer)

    expect(seen).toEqual(['g1', 'g2'])
    expect(summary).toEqual({ flushed: 1, failed: 0, remaining: 2 })
    expect(readPendingResults(storage)).toEqual([second, third])
  })

  it('moves a permanently rejected entry aside and keeps flushing the rest', async () => {
    const storage = makeMemoryStorage()
    const [rejected, valid] = [pendingResult('g1'), pendingResult('g2')]
    appendPendingResult(storage, rejected)
    appendPendingResult(storage, valid)
    const writer = writerThat((entry) =>
      entry.result.gameId === 'g1'
        ? Promise.reject(Object.assign(new Error('denied'), { code: 'permission-denied' }))
        : Promise.resolve(),
    )

    const summary = await flushPendingResults(storage, writer)

    expect(summary).toEqual({ flushed: 1, failed: 1, remaining: 0 })
    expect(readPendingResults(storage)).toEqual([])
    expect(JSON.parse(storage.getItem(FAILED_RESULTS_STORAGE_KEY) ?? '[]')).toEqual([rejected])
  })

  it('never retries a moved-aside entry on the next flush', async () => {
    const storage = makeMemoryStorage()
    appendPendingResult(storage, pendingResult('g1'))
    const writer = writerThat(() =>
      Promise.reject(Object.assign(new Error('denied'), { code: 'permission-denied' })),
    )
    await flushPendingResults(storage, writer)

    const summary = await flushPendingResults(storage, writer)

    expect(summary).toEqual({ flushed: 0, failed: 0, remaining: 0 })
    expect(writer.write).toHaveBeenCalledTimes(1)
  })

  it('keeps a result queued while an earlier write is still in flight', async () => {
    const storage = makeMemoryStorage()
    appendPendingResult(storage, pendingResult('g1'))
    let finishWrite: () => void = () => undefined
    const writer = writerThat(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        }),
    )

    const flushing = flushPendingResults(storage, writer)
    const lateArrival = pendingResult('g2')
    appendPendingResult(storage, lateArrival)
    finishWrite()
    const summary = await flushing

    expect(summary).toEqual({ flushed: 1, failed: 0, remaining: 1 })
    expect(readPendingResults(storage)).toEqual([lateArrival])
  })

  it('persists the reduced queue back to storage, visible to a later read', async () => {
    const storage = makeMemoryStorage()
    appendPendingResult(storage, pendingResult('g1'))
    appendPendingResult(storage, pendingResult('g2'))
    const writer = writerThat(() => Promise.resolve())
    await flushPendingResults(storage, writer)

    expect(readPendingResults(makeMemoryStorage())).toEqual([])
    expect(readPendingResults(storage)).toEqual([])
  })
})

describe('pending results when storage refuses to be read', () => {
  it('reads nothing and queues without throwing, like a blocked storage in a private window', () => {
    const blocked: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    }

    expect(readPendingResults(blocked)).toEqual([])
    expect(() =>
      appendPendingResult(blocked, {
        result: { gameId: 'g', finishedAt: '2026-01-01T00:00:00.000Z', totalRounds: 5 },
        players: [],
      }),
    ).not.toThrow()
  })
})
