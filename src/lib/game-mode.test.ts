import { describe, expect, it, vi } from 'vitest'
import { createHostRepository, createJoinRepository } from './game-mode'
import type { GameRepository } from './repository'

/** Stands in for a real repository — these tests only care which constructor was invoked. */
function makeFakeRepository(): GameRepository {
  return {} as GameRepository
}

describe('createHostRepository', () => {
  it('builds the online repository when the backend is reachable', async () => {
    const onlineRepository = makeFakeRepository()
    const createOnlineRepository = vi.fn().mockReturnValue(onlineRepository)
    const createLocalRepository = vi.fn().mockReturnValue(makeFakeRepository())

    const mode = await createHostRepository({
      probeBackendReachable: () => Promise.resolve(true),
      createOnlineRepository,
      createLocalRepository,
    })

    expect(mode).toEqual({ kind: 'online', repository: onlineRepository })
  })

  it('does not construct the local repository when the backend is reachable', async () => {
    const createLocalRepository = vi.fn().mockReturnValue(makeFakeRepository())

    await createHostRepository({
      probeBackendReachable: () => Promise.resolve(true),
      createOnlineRepository: () => makeFakeRepository(),
      createLocalRepository,
    })

    expect(createLocalRepository).not.toHaveBeenCalled()
  })

  it('builds the local repository when the backend is unreachable', async () => {
    const localRepository = makeFakeRepository()
    const createOnlineRepository = vi.fn().mockReturnValue(makeFakeRepository())
    const createLocalRepository = vi.fn().mockReturnValue(localRepository)

    const mode = await createHostRepository({
      probeBackendReachable: () => Promise.resolve(false),
      createOnlineRepository,
      createLocalRepository,
    })

    expect(mode).toEqual({ kind: 'offline', repository: localRepository })
  })

  it('does not construct the online repository when the backend is unreachable', async () => {
    const createOnlineRepository = vi.fn().mockReturnValue(makeFakeRepository())

    await createHostRepository({
      probeBackendReachable: () => Promise.resolve(false),
      createOnlineRepository,
      createLocalRepository: () => makeFakeRepository(),
    })

    expect(createOnlineRepository).not.toHaveBeenCalled()
  })
})

describe('createJoinRepository', () => {
  it('builds the online repository when the backend is reachable', async () => {
    const onlineRepository = makeFakeRepository()

    const mode = await createJoinRepository({
      probeBackendReachable: () => Promise.resolve(true),
      createOnlineRepository: () => onlineRepository,
    })

    expect(mode).toEqual({ kind: 'online', repository: onlineRepository })
  })

  it('reports unreachable, without constructing a repository, when the backend is unreachable', async () => {
    const createOnlineRepository = vi.fn().mockReturnValue(makeFakeRepository())

    const mode = await createJoinRepository({
      probeBackendReachable: () => Promise.resolve(false),
      createOnlineRepository,
    })

    expect(mode).toEqual({ kind: 'unreachable' })
    expect(createOnlineRepository).not.toHaveBeenCalled()
  })
})
