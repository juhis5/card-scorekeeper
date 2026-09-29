/**
 * Which of the shown players go by a name they claimed, for the badge. A name counts only for the
 * claim's own owner: someone else's older entry under that name never looks claimed, and neither
 * does a host's guest. Claims are read once per name and kept for the session; the badge is an
 * extra, so a failed read just shows no badge.
 */
import { shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import type { NameClaim } from '@/lib/data/name-claims'
import { isUnavailable } from '@/lib/data/write-errors'
import { playerNameKey } from '@/lib/game/player-names'
import { reportHandledError } from '@/lib/platform/error-reporting'

export interface NamedPlayer {
  playerId: string
  name: string
}

/** A claim's owner by name key; null when nobody claimed the name. */
const ownersByNameKey = new Map<string, Promise<string | null>>()

type ClaimReader = (name: string) => Promise<NameClaim | null>

/** Firebase loads and signs in once, shared by every read. */
let claimReader: Promise<ClaimReader> | null = null

async function loadClaimReader(): Promise<ClaimReader> {
  const [{ ensureSignedIn, getDb }, { readNameClaim }] = await Promise.all([
    import('@/lib/data/firebase'),
    import('@/lib/data/name-claims'),
  ])
  await ensureSignedIn()
  return (name) => readNameClaim(getDb(), name)
}

async function readOwner(name: string): Promise<string | null> {
  claimReader ??= loadClaimReader().catch((error: unknown) => {
    claimReader = null
    throw error
  })
  const claim = await (await claimReader)(name)
  return claim?.ownerUid ?? null
}

function ownerOf(name: string): Promise<string | null> {
  const key = playerNameKey(name)
  const cached = ownersByNameKey.get(key)
  if (cached) return cached
  const owner = readOwner(name).catch((error: unknown) => {
    // Not kept: the next list asks again.
    ownersByNameKey.delete(key)
    if (!isUnavailable(error)) reportHandledError(error, 'read-name-claim')
    return null
  })
  ownersByNameKey.set(key, owner)
  return owner
}

/** A claim this device just made (or moved away from, `null`), so badges follow without a read. */
export function rememberClaim(name: string, ownerUid: string | null): void {
  ownersByNameKey.set(playerNameKey(name), Promise.resolve(ownerUid))
}

/** For tests: every read starts fresh. */
export function forgetClaims(): void {
  ownersByNameKey.clear()
  claimReader = null
}

/** The ids of `players` who claimed the name they're shown under. Pass none for a local game. */
export function useClaimedNames(
  players: MaybeRefOrGetter<readonly NamedPlayer[]>,
): Ref<ReadonlySet<string>> {
  const claimed = shallowRef<ReadonlySet<string>>(new Set())
  let generation = 0

  watch(
    // A string, so a new array of the same players (every score change) doesn't read again.
    () =>
      toValue(players)
        .map(({ playerId, name }) => `${playerId}\n${name}`)
        .join('\n\n'),
    async () => {
      generation += 1
      const current = generation
      const shown = toValue(players)
      const owners = await Promise.all(shown.map(({ name }) => ownerOf(name)))
      // A newer list replaced this one while its claims were read.
      if (current !== generation) return
      claimed.value = new Set(
        shown.filter((player, index) => owners[index] === player.playerId).map((p) => p.playerId),
      )
    },
    { immediate: true },
  )

  return claimed
}
