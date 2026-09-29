/**
 * This player's invites to games a host added them to by their claimed name: the open ones live,
 * each with where its game stands, and answering them. Accepting a finished game counts it at
 * once; one still running is counted by the result upload once it finishes (reconnect-flush.ts).
 * Answers go one at a time: each count updates the same running totals.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Firestore, Unsubscribe } from 'firebase/firestore'
import { forgetAcceptedInvite, rememberAcceptedInvite } from '@/lib/data/accepted-invites'
import type { Invite, InviteGame } from '@/lib/data/invites'
import { browserLocalStorage } from '@/lib/data/key-value-storage'
import { appendPendingHighscores } from '@/lib/data/pending-results'
import { isUnavailable } from '@/lib/data/write-errors'
import { reportHandledError } from '@/lib/platform/error-reporting'

export type InvitesStatus = 'idle' | 'loading' | 'ready' | 'error'

/** `game` is null until its room has been read. */
export interface InviteView extends Invite {
  game: InviteGame | null
}

export type InviteNotice = 'counted' | 'accepted' | 'declined' | 'offline' | 'failed'

interface Connection {
  db: Firestore
  uid: string
  invites: typeof import('@/lib/data/invites')
  publishHighscores: (typeof import('@/lib/data/firestore-stats'))['publishHighscores']
}

interface Session extends Connection {
  unsubscribe: Unsubscribe
}

export const useInvitesStore = defineStore('invites', () => {
  const status = ref<InvitesStatus>('idle')
  const invites = ref<InviteView[]>([])
  const busyInviteId = ref<string | null>(null)
  const notice = ref<InviteNotice | null>(null)
  const pendingCount = ref(0)
  const gamesById = new Map<string, InviteGame>()
  let session: Session | null = null
  let latest: Invite[] = []

  function show(): void {
    invites.value = latest.map((invite) => ({
      ...invite,
      game: gamesById.get(invite.gameId) ?? null,
    }))
  }

  /** Reads each game not read yet. Failures leave it unknown: the invite still shows. */
  async function readGames(current: Connection): Promise<void> {
    const unread = [...new Set(latest.map((invite) => invite.gameId))].filter(
      (gameId) => !gamesById.has(gameId),
    )
    await Promise.all(
      unread.map(async (gameId) => {
        try {
          gamesById.set(gameId, await current.invites.readInviteGame(current.db, gameId))
        } catch (error) {
          if (!isUnavailable(error)) reportHandledError(error, 'read-invite-game')
        }
      }),
    )
    show()
  }

  /** Follows this player's open invites. Never throws: a failure lands on `error`. */
  async function start(): Promise<void> {
    if (session || status.value === 'loading') return
    status.value = 'loading'
    try {
      const [{ ensureSignedIn, getDb }, invitesModule, { publishHighscores }] = await Promise.all([
        import('@/lib/data/firebase'),
        import('@/lib/data/invites'),
        import('@/lib/data/firestore-stats'),
      ])
      const uid = await ensureSignedIn()
      const db = getDb()
      const connection: Connection = { db, uid, invites: invitesModule, publishHighscores }
      const unsubscribe = invitesModule.watchInvites(
        db,
        uid,
        (list) => {
          latest = list
          status.value = 'ready'
          show()
          void readGames(connection)
        },
        (error) => {
          if (!isUnavailable(error)) reportHandledError(error, 'watch-invites')
          status.value = 'error'
        },
      )
      session = { ...connection, unsubscribe }
    } catch (error) {
      if (!isUnavailable(error)) reportHandledError(error, 'start-invites')
      status.value = 'error'
    }
  }

  function stop(): void {
    session?.unsubscribe()
    session = null
    latest = []
    invites.value = []
    status.value = 'idle'
  }

  /** How many invites wait for an answer, for Home. Never throws: a failure counts none. */
  async function loadPendingCount(): Promise<void> {
    try {
      const [{ ensureSignedIn, getDb }, { countPendingInvites }] = await Promise.all([
        import('@/lib/data/firebase'),
        import('@/lib/data/invites'),
      ])
      pendingCount.value = await countPendingInvites(getDb(), await ensureSignedIn())
    } catch (error) {
      if (!isUnavailable(error)) reportHandledError(error, 'count-pending-invites')
      pendingCount.value = 0
    }
  }

  async function answering(
    invite: InviteView,
    answer: (current: Session) => Promise<InviteNotice>,
  ): Promise<void> {
    if (!session || busyInviteId.value) return
    busyInviteId.value = invite.id
    notice.value = null
    try {
      notice.value = await answer(session)
    } catch (error) {
      if (isUnavailable(error)) {
        notice.value = 'offline'
      } else {
        reportHandledError(error, 'answer-invite')
        notice.value = 'failed'
      }
    } finally {
      busyInviteId.value = null
    }
  }

  /** Counts a finished game now (then its public entry); a running one once it finishes. */
  async function acceptWith(current: Connection, invite: InviteView): Promise<InviteNotice> {
    const storage = browserLocalStorage()
    if (invite.game === 'finished') {
      const counted = await current.invites.countInvite(current.db, current.uid, invite)
      if (counted) {
        forgetAcceptedInvite(storage, invite.id)
        const unpublished = await current.publishHighscores(current.db, counted.result, [
          counted.row,
        ])
        if (unpublished.length > 0) {
          appendPendingHighscores(storage, { result: counted.result, players: unpublished })
        }
        return 'counted'
      }
    }
    if (invite.status !== 'accepted') {
      await current.invites.answerInvite(current.db, invite.id, 'accepted')
    }
    rememberAcceptedInvite(storage, invite.id)
    return 'accepted'
  }

  function accept(invite: InviteView): Promise<void> {
    return answering(invite, (current) => acceptWith(current, invite))
  }

  /** Declines, or dismisses one whose game ended without a result. */
  function decline(invite: InviteView): Promise<void> {
    return answering(invite, async (current) => {
      await current.invites.answerInvite(current.db, invite.id, 'declined')
      forgetAcceptedInvite(browserLocalStorage(), invite.id)
      return 'declined'
    })
  }

  /** Every pending invite whose game can still count, one after another. */
  async function acceptAll(): Promise<void> {
    const waiting = invites.value.filter(
      (invite) => invite.status === 'pending' && invite.game !== 'ended',
    )
    for (const invite of waiting) {
      await accept(invite)
      if (notice.value === 'offline' || notice.value === 'failed') return
    }
  }

  return {
    status,
    invites,
    busyInviteId,
    notice,
    pendingCount,
    start,
    stop,
    loadPendingCount,
    accept,
    decline,
    acceptAll,
  }
})
