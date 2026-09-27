/**
 * Chooses which `GameRepository` backs a new or joined game (see docs/PLAN.md "Offline host
 * mode" and the firestore-realtime skill). Kept mode-agnostic like `repository.ts` itself — no
 * import of a concrete repository or Firebase here; callers inject both the probe and the
 * constructors, so this stays unit-testable with fakes.
 *
 * Host and join are separate functions, not one with a flag: hosting can fall back to a local
 * single-device game when unreachable, but joining can't — there is no local room to join, so an
 * unreachable backend is a distinct, unrecoverable-here outcome the caller turns into a friendly
 * error (see error-ux) rather than a silent local game.
 */
import type { GameRepository } from './repository'

export type HostGameMode =
  { kind: 'online'; repository: GameRepository } | { kind: 'offline'; repository: GameRepository }

export interface CreateHostRepositoryDeps {
  probeBackendReachable: () => Promise<boolean>
  createOnlineRepository: () => GameRepository
  createLocalRepository: () => GameRepository
}

/** Host path: reachable → online (Firestore) repository; unreachable → local single-device one. */
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

/** Join path: online only. An unreachable backend can't be worked around locally. */
export async function createJoinRepository(deps: CreateJoinRepositoryDeps): Promise<JoinGameMode> {
  const reachable = await deps.probeBackendReachable()
  return reachable
    ? { kind: 'online', repository: deps.createOnlineRepository() }
    : { kind: 'unreachable' }
}
