/**
 * Builds game repositories on the real Firebase backend. Firebase loads lazily, so an offline host
 * never downloads it. Any load failure (no chunk, a broken config) degrades like an unreachable
 * backend: the host gets a local game, a joiner the friendly error.
 */
import { probeBackendReachable } from '@/lib/platform/connectivity'
import { createHostRepository, createJoinRepository } from '@/lib/data/game-mode'
import type { HostGameMode, JoinGameMode } from '@/lib/data/game-mode'
import { LocalGameRepository } from '@/lib/data/local-repository'
import type { ResumableGameRepository } from '@/lib/data/repository'
import { reportHandledError } from '@/lib/platform/error-reporting'

async function loadFirebase() {
  const [{ getFirebaseAuth, getDb, checkBackendReachable }, { FirestoreGameRepository }] =
    await Promise.all([import('@/lib/data/firebase'), import('@/lib/data/firestore-repository')])
  // Called here so a bad config's synchronous throw becomes a rejection the callers catch.
  const auth = getFirebaseAuth()
  const db = getDb()
  return {
    auth,
    db,
    checkBackend: () => checkBackendReachable(auth, db),
    FirestoreGameRepository,
  }
}

export function useGameConnectivity() {
  /** A local single-device game: the fallback whenever an online room can't be had. */
  function localRepository(): HostGameMode {
    return { kind: 'offline', repository: new LocalGameRepository() }
  }

  /** A fresh Firestore room when reachable, otherwise a local game. */
  async function hostRepository(): Promise<HostGameMode> {
    try {
      const { auth, db, checkBackend, FirestoreGameRepository } = await loadFirebase()
      return await createHostRepository({
        probeBackendReachable: () => probeBackendReachable({ checkBackend }),
        createOnlineRepository: () => new FirestoreGameRepository({ db, auth }),
        createLocalRepository: () => new LocalGameRepository(),
      })
    } catch (error) {
      // Firebase didn't load: degrade like an unreachable backend, never fail "Start game".
      reportHandledError(error, 'host-online-setup')
      return localRepository()
    }
  }

  /** Online only: there is no local room to join, so any failure is "unreachable". */
  async function joinRepository(roomCode: string): Promise<JoinGameMode> {
    try {
      const { auth, db, checkBackend, FirestoreGameRepository } = await loadFirebase()
      return await createJoinRepository({
        probeBackendReachable: () => probeBackendReachable({ checkBackend }),
        createOnlineRepository: () => new FirestoreGameRepository({ db, auth, roomCode }),
      })
    } catch (error) {
      reportHandledError(error, 'join-online-setup')
      return { kind: 'unreachable' }
    }
  }

  /** Play again: a fresh room, never a local game, as the other phones wait to follow it. */
  async function nextRoomRepository(): Promise<JoinGameMode> {
    try {
      const { auth, db, checkBackend, FirestoreGameRepository } = await loadFirebase()
      return await createJoinRepository({
        probeBackendReachable: () => probeBackendReachable({ checkBackend }),
        createOnlineRepository: () => new FirestoreGameRepository({ db, auth }),
      })
    } catch (error) {
      reportHandledError(error, 'next-room-setup')
      return { kind: 'unreachable' }
    }
  }

  /** No probe: after a reload, the seat can be found in Firestore's cache while offline. */
  async function resumeRepository(roomCode: string): Promise<ResumableGameRepository | null> {
    try {
      const { auth, db, FirestoreGameRepository } = await loadFirebase()
      return new FirestoreGameRepository({ db, auth, roomCode })
    } catch (error) {
      reportHandledError(error, 'resume-setup')
      return null
    }
  }

  return {
    hostRepository,
    joinRepository,
    localRepository,
    nextRoomRepository,
    resumeRepository,
  }
}
