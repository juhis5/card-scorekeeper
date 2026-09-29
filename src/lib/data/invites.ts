/**
 * Invites (see firestore.rules): a host added this player to a game by their claimed name, as an
 * invited guest. The game counts for them once they accept: their own stats row, a copy of the
 * guest's, written with the invite marked counted. Accepting a game still running waits until it
 * finishes (see reconnect-flush.ts).
 */
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  writeBatch,
  updateDoc,
  type Firestore,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import type { GamePlayer, GameResult } from '../game/types'
import { withTimeout } from '../platform/timeout'

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'counted'

export interface Invite {
  id: string
  gameId: string
  guestId: string
  hostName: string
  /** The name the host added them under: their claimed name. */
  name: string
  status: InviteStatus
  /** Epoch ms; null until the server stamps it. */
  createdAt: number | null
}

/** `ended`: abandoned, or expired while still running, so it will never have a result. */
export type InviteGame = 'running' | 'finished' | 'ended'

/** A counted invite's row, with the game result its public entry needs. */
export interface CountedInvite {
  result: GameResult
  row: GamePlayer
}

/** Invite writes the page waits on are bounded: offline, Firestore would wait for good. */
const INVITE_TIMEOUT_MS = 10_000

interface InviteDocData {
  gameId: string
  guestId: string
  hostName: string
  name: string
  status: InviteStatus
  createdAt: Timestamp | null
}

function toInvite(id: string, data: InviteDocData): Invite {
  return {
    id,
    gameId: data.gameId,
    guestId: data.guestId,
    hostName: data.hostName,
    name: data.name,
    status: data.status,
    createdAt: data.createdAt?.toMillis() ?? null,
  }
}

/** This player's open invites (pending or accepted), newest first, live. */
export function watchInvites(
  db: Firestore,
  uid: string,
  onChange: (invites: Invite[]) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  const open = query(
    collection(db, 'invites'),
    where('invitedUid', '==', uid),
    where('status', 'in', ['pending', 'accepted']),
  )
  return onSnapshot(
    open,
    (snapshot) => {
      const invites = snapshot.docs.map((invite) =>
        toInvite(invite.id, invite.data() as InviteDocData),
      )
      onChange(invites.sort((a, b) => (b.createdAt ?? Infinity) - (a.createdAt ?? Infinity)))
    },
    onError,
  )
}

export async function readInvite(db: Firestore, inviteId: string): Promise<Invite | null> {
  const snapshot = await withTimeout(getDoc(doc(db, 'invites', inviteId)), INVITE_TIMEOUT_MS)
  return snapshot.exists() ? toInvite(snapshot.id, snapshot.data() as InviteDocData) : null
}

/** Where the invite's game stands. Any signed-in player may get a room by its code. */
export async function readInviteGame(
  db: Firestore,
  gameId: string,
  now: number = Date.now(),
): Promise<InviteGame> {
  const room = await withTimeout(getDoc(doc(db, 'room', gameId)), INVITE_TIMEOUT_MS)
  const data = room.data() as { status: string; expiresAt: Timestamp } | undefined
  if (data?.status === 'finished') return 'finished'
  if (!data || data.status === 'abandoned' || data.expiresAt.toMillis() <= now) return 'ended'
  return 'running'
}

export function answerInvite(
  db: Firestore,
  inviteId: string,
  status: 'accepted' | 'declined',
): Promise<void> {
  return withTimeout(updateDoc(doc(db, 'invites', inviteId), { status }), INVITE_TIMEOUT_MS)
}

/**
 * Counts a finished game's invite as the player's: their row, a copy of the guest's, and the
 * invite marked counted, in one batch as the rules require. Null when the game has no result
 * yet (the guest row is written as the game finishes).
 */
export async function countInvite(
  db: Firestore,
  uid: string,
  invite: Pick<Invite, 'id' | 'gameId' | 'guestId'>,
): Promise<CountedInvite | null> {
  const [guestRow, result] = await Promise.all([
    withTimeout(
      getDoc(doc(db, 'game_player', `${invite.gameId}_${invite.guestId}`)),
      INVITE_TIMEOUT_MS,
    ),
    withTimeout(getDoc(doc(db, 'game_result', invite.gameId)), INVITE_TIMEOUT_MS),
  ])
  if (!guestRow.exists() || !result.exists()) return null
  const guest = guestRow.data() as GamePlayer & { participantUids: string[] }
  const row: GamePlayer = {
    gameId: invite.gameId,
    deviceUuid: uid,
    displayName: guest.displayName,
    finalScore: guest.finalScore,
    placement: guest.placement,
    bestRound: guest.bestRound,
    worstRound: guest.worstRound,
    replacesGuestId: invite.guestId,
  }
  const batch = writeBatch(db)
  batch.set(doc(db, 'game_player', `${invite.gameId}_${uid}`), {
    ...row,
    participantUids: guest.participantUids,
  })
  batch.update(doc(db, 'invites', invite.id), { status: 'counted' })
  await withTimeout(batch.commit(), INVITE_TIMEOUT_MS)
  const { finishedAt, totalRounds } = result.data() as GameResult
  return { result: { gameId: invite.gameId, finishedAt, totalRounds }, row }
}
