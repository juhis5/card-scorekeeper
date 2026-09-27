/**
 * Picks the `GameRepository` for a game; callers inject the probe and constructors. Hosting falls
 * back to a local game when the backend is unreachable. Joining can't, as there is no local room
 * to join, so it reports `unreachable` instead.
 */
import type { GameRepository } from './repository'

export type HostGameMode =
  { kind: 'online'; repository: GameRepository } | { kind: 'offline'; repository: GameRepository }

export interface CreateHostRepositoryDeps {
  probeBackendReachable: () => Promise<boolean>
  createOnlineRepository: () => GameRepository
  createLocalRepository: () => GameRepository
}

export async function createHostRepository(deps: CreateHostRepositoryDeps): Promise<HostGameMode> {
  const reachable = await deps.probeBackendReachable()
  return reachable
    ? { kind: 'online', repository: deps.createOnlineRepository() }
    : { kind: 'offline', repository: deps.createLocalRepository() }
}

export type JoinGameMode = { kind: 'online'; repository: GameRepository } | { kind: 'unreachable' }

export interface CreateJoinRepositoryDeps {
  probeBackendReachable: () => Promise<boolean>
  createOnlineRepository: () => GameRepository
}

export async function createJoinRepository(deps: CreateJoinRepositoryDeps): Promise<JoinGameMode> {
  const reachable = await deps.probeBackendReachable()
  return reachable
    ? { kind: 'online', repository: deps.createOnlineRepository() }
    : { kind: 'unreachable' }
}
