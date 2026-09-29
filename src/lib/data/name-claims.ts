/**
 * Claimed names (see firestore.rules): a Google account's one name, which nobody else can take a
 * seat under. First come; its owner may move it to a new name, which frees the old one. The app's
 * owner can also release one, by deleting both its `claimedNames` doc and its owner's
 * `claimOwners` doc in the console.
 */
import { doc, getDoc, writeBatch, type Firestore } from 'firebase/firestore'
import { cleanPlayerName, playerNameKey } from '@/lib/game/player-names'
import { withTimeout } from '@/lib/platform/timeout'
import { isPermissionDenied } from './write-errors'

export interface NameClaim {
  name: string
  ownerUid: string
}

export type ClaimOutcome = 'claimed' | 'taken'

/** Reads and the write are bounded: offline, Firestore would wait for good. */
const CLAIM_TIMEOUT_MS = 10_000

export async function readNameClaim(db: Firestore, name: string): Promise<NameClaim | null> {
  const snapshot = await withTimeout(
    getDoc(doc(db, 'claimedNames', playerNameKey(name))),
    CLAIM_TIMEOUT_MS,
  )
  return snapshot.exists() ? (snapshot.data() as NameClaim) : null
}

/** The name this account claimed, or null if it has none. */
export async function readOwnClaim(db: Firestore, uid: string): Promise<string | null> {
  const owner = await withTimeout(getDoc(doc(db, 'claimOwners', uid)), CLAIM_TIMEOUT_MS)
  if (!owner.exists()) return null
  const { nameKey } = owner.data() as { nameKey: string }
  const claim = await withTimeout(getDoc(doc(db, 'claimedNames', nameKey)), CLAIM_TIMEOUT_MS)
  return claim.exists() ? (claim.data() as NameClaim).name : null
}

async function outcomeOf(db: Firestore, uid: string, name: string): Promise<ClaimOutcome | null> {
  const claim = await readNameClaim(db, name)
  if (!claim) return null
  return claim.ownerUid === uid ? 'claimed' : 'taken'
}

/** The key of the claim `uid` holds now, if its doc is still there (not released). */
async function heldClaimKey(db: Firestore, uid: string): Promise<string | null> {
  const owner = await withTimeout(getDoc(doc(db, 'claimOwners', uid)), CLAIM_TIMEOUT_MS)
  if (!owner.exists()) return null
  const { nameKey } = owner.data() as { nameKey: string }
  const claim = await withTimeout(getDoc(doc(db, 'claimedNames', nameKey)), CLAIM_TIMEOUT_MS)
  return claim.exists() ? nameKey : null
}

/**
 * Claims `name` for `uid`, moving the account's claim if it has one: the owner doc, the new
 * claim and the old claim's delete in one batch, as the rules require.
 */
export async function claimName(db: Firestore, uid: string, name: string): Promise<ClaimOutcome> {
  const cleanName = cleanPlayerName(name)
  const existing = await outcomeOf(db, uid, cleanName)
  if (existing) return existing

  const nameKey = playerNameKey(cleanName)
  const heldKey = await heldClaimKey(db, uid)
  const batch = writeBatch(db)
  batch.set(doc(db, 'claimOwners', uid), { nameKey })
  batch.set(doc(db, 'claimedNames', nameKey), { name: cleanName, ownerUid: uid })
  if (heldKey) batch.delete(doc(db, 'claimedNames', heldKey))
  try {
    await withTimeout(batch.commit(), CLAIM_TIMEOUT_MS)
    return 'claimed'
  } catch (error) {
    // Someone claimed it in the moment between the read and the write.
    if (isPermissionDenied(error) && (await outcomeOf(db, uid, cleanName)) === 'taken') {
      return 'taken'
    }
    throw error
  }
}
