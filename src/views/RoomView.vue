<script setup lang="ts">
/**
 * The live scoreboard: contract banner, standings table, per-player round-score entry, and the
 * next-round/finish actions. Talks only to `useGameStore` — no repository, no Firestore, no
 * business logic here beyond thin UI orchestration.
 *
 * Online vs offline (see docs/DECISIONS.md's 2026-07-24 online entries + the firestore-realtime
 * skill): offline, the host enters every player's score and drives Next/Finish, unchanged from
 * slice 3. Online, each device edits only its OWN row (`myPlayerId`) — Firestore rules enforce
 * this too, this is the matching UI — and only the host (`isHost`) sees Next/Finish; a joiner
 * waits. Never gate any of this on `status === 'playing'`: online, `status` stays `'waiting'`
 * until the host's first `advanceRound()` (see DECISIONS.md), so gating on it would hide round 1.
 */
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'
import { WifiOff } from '@lucide/vue'
import ContractBanner from '@/components/ContractBanner.vue'
import RemovePlayerControl from '@/components/RemovePlayerControl.vue'
import ScoreCard from '@/components/ScoreCard.vue'
import ScoreBoard from '@/components/ScoreBoard.vue'
import WinnerBanner from '@/components/WinnerBanner.vue'
import { Button } from '@/components/ui/button'
import { useConnectionStatus } from '@/composables/useConnectionStatus'
import { useGameConnectivity } from '@/composables/useGameConnectivity'
import { LOCAL_GAME_ROUTE_CODE } from '@/lib/local-game-route'
import { isEveryRoundScored, missingRounds, pointsFor, TOTAL_ROUNDS } from '@/lib/rules'
import { isPermissionDenied } from '@/lib/write-errors'
import { useGameStore } from '@/stores/game'
import type { PlayerId } from '@/lib/repository'
import type { ContractRoundNumber, Player, Standing } from '@/lib/types'

const { t, n } = useI18n()
const route = useRoute()
const game = useGameStore()
const {
  standings,
  currentContract,
  currentRound,
  completedRounds,
  status,
  winners,
  roundScores,
  isHost,
  myPlayerId,
  isOnline,
  roomCode,
  connectionError,
} = storeToRefs(game)
const { resumeRepository } = useGameConnectivity()
// Mid-game connectivity blip, distinct from the never-connected `!isOnline` banner below (see
// the error-ux skill's "the two offline modes") — only ever shown while `isOnline` (a live room).
const { isReconnecting } = useConnectionStatus()

const announcement = ref('')
/** Why the last score, Next or Finish didn't save. Cleared by the next save that succeeds. */
const saveError = ref('')
const isAdvancing = ref(false)
const scoreEntryHeading = useTemplateRef<HTMLHeadingElement>('scoreEntryHeading')
const isFinishing = ref(false)

// `standings` is sorted by total, so it reorders after every commit — great for the scoreboard,
// terrible for the entry list (a row would slide out from under a player's thumb mid-entry).
// Grow a fixed seat order as players are first seen (never reorder, never drop) instead of a
// one-time snapshot at mount: online, the first Firestore snapshot arrives asynchronously (this
// component can mount before any player — even the host — has shown up yet), and new joiners can
// arrive at any time during the game, so a frozen mount-time list would miss them permanently.
const seatOrder = ref<PlayerId[]>([])
watch(
  standings,
  (list) => {
    for (const standing of list) {
      if (!seatOrder.value.includes(standing.player.id)) {
        seatOrder.value.push(standing.player.id)
      }
    }
  },
  { immediate: true },
)
// The host (offline or online) enters and fixes anyone's score; an online joiner edits only their
// own seat. firestore.rules enforces the same split.
const entryStandings = computed(() => {
  const ordered = seatOrder.value
    .map((playerId) => standings.value.find((standing) => standing.player.id === playerId))
    .filter((standing): standing is Standing => standing !== undefined)
  return isHost.value
    ? ordered
    : ordered.filter((standing) => standing.player.id === myPlayerId.value)
})

/** Earlier rounds an editable player has no score for: a late joiner fills these in, so nobody is
 * ranked on fewer rounds than the others. */
const missedRoundCards = computed(() =>
  entryStandings.value.flatMap(({ player }) =>
    missingRounds(player.id, roundScores.value, currentRound.value)
      .filter((round) => round < currentRound.value)
      .map((round) => ({ player, round })),
  ),
)

const hasActiveGame = computed(() => standings.value.length > 0)
const isFinalRound = computed(() => currentRound.value === TOTAL_ROUNDS)
const isFinished = computed(() => status.value === 'finished')
// Every round so far, not just the current one: a late joiner's missed rounds block Next too.
const allPlayersScored = computed(() =>
  isEveryRoundScored(
    standings.value.map((standing) => standing.player.id),
    roundScores.value,
    currentRound.value,
  ),
)

// Card points come from the synced `roundScores`, not view-local commits: online, other devices'
// scores only ever arrive through the subscription, and a host correction must show up too.
/** Scores this device entered, as "playerId-round". The host may see those numbers on other
 * players' cards; scores players entered themselves stay "scored" there until the round is
 * revealed. Device memory only: after a reload the host sees "scored" for them too. */
const scoresEnteredHere = ref(new Set<string>())

function scoreKey(playerId: PlayerId, round: ContractRoundNumber): string {
  return `${playerId}-${round}`
}

function canSeePoints(playerId: PlayerId, round: ContractRoundNumber): boolean {
  return playerId === myPlayerId.value || scoresEnteredHere.value.has(scoreKey(playerId, round))
}

/** A non-host player's own card reads "Enter your points"; the host sees names on every card. */
function isOwnCard(playerId: PlayerId): boolean {
  return !isHost.value && playerId === myPlayerId.value
}

function canRemove(playerId: PlayerId): boolean {
  return isHost.value && playerId !== myPlayerId.value
}

/** The rules refuse every write to an expired room; any other failure is worth retrying. */
function describeSaveFailure(error: unknown, retryMessage: string): string {
  return isPermissionDenied(error) ? t('room.saveError.closed') : retryMessage
}

async function handleScoreCommit(
  playerId: PlayerId,
  round: ContractRoundNumber,
  points: number,
): Promise<void> {
  const player = standings.value.find((standing) => standing.player.id === playerId)?.player
  try {
    await game.setRoundScore({ playerId, round, points })
  } catch (error) {
    saveError.value = describeSaveFailure(
      error,
      t('room.saveError.score', { name: player?.name ?? '' }),
    )
    return
  }
  saveError.value = ''
  scoresEnteredHere.value.add(scoreKey(playerId, round))
  if (!player) return

  const isLeading = standings.value[0]?.player.id === playerId
  announcement.value = isLeading
    ? t('room.live.scoreEnteredLeading', { name: player.name, points: n(points) })
    : t('room.live.scoreEntered', { name: player.name, points: n(points) })
}

async function handleRemovePlayer(player: Player): Promise<void> {
  try {
    await game.removePlayer(player.id)
  } catch (error) {
    saveError.value = describeSaveFailure(error, t('room.saveError.remove', { name: player.name }))
    return
  }
  saveError.value = ''
  announcement.value = t('room.live.playerRemoved', { name: player.name })
  // The removed player's card (and the focused control in it) is gone; keep the host's place.
  await nextTick()
  scoreEntryHeading.value?.focus()
}

async function handleNextRound(): Promise<void> {
  isAdvancing.value = true
  try {
    await game.advanceRound()
    saveError.value = ''
  } catch (error) {
    saveError.value = describeSaveFailure(error, t('room.saveError.nextRound'))
  } finally {
    isAdvancing.value = false
  }
}

async function handleFinish(): Promise<void> {
  isFinishing.value = true
  try {
    // No separate "game finished" announcement here: WinnerBanner is its own `role="status"`
    // region and announces itself the moment it mounts — a second live region saying the same
    // thing would violate "announce sparingly" (a11y-mobile).
    await game.finishGame()
    saveError.value = ''
  } catch (error) {
    saveError.value = describeSaveFailure(error, t('room.saveError.finish'))
  } finally {
    isFinishing.value = false
  }
}

const routeCode = computed(() => String(route.params.code))
/** Resuming an online room after a reload: 'opening' while this device's seat is looked up,
 * 'not-seated' when it has none there. */
const resumeState = ref<'idle' | 'opening' | 'not-seated'>('idle')
// Online, the store knows the room before its first snapshot arrives (just after joining, or
// resuming), so "no players yet" means "still opening", not "no game".
const isOpeningRoom = computed(
  () =>
    resumeState.value === 'opening' ||
    (isOnline.value && !hasActiveGame.value && connectionError.value === null),
)

async function resumeOnlineRoom(code: string): Promise<void> {
  resumeState.value = 'opening'
  const repository = await resumeRepository(code)
  const isResumed = repository
    ? await game.resumeOnline(repository, code).catch(() => false)
    : false
  resumeState.value = isResumed ? 'idle' : 'not-seated'
}

// A reload loses the in-memory store. The local sentinel resumes the game kept in localStorage;
// a real room code resumes this device's seat in that online room. Never the other way round:
// reloading an online room must not pick up a stale local game.
onMounted(async () => {
  if (hasActiveGame.value || roomCode.value === routeCode.value) return
  if (routeCode.value === LOCAL_GAME_ROUTE_CODE) {
    game.resume()
    return
  }
  await resumeOnlineRoom(routeCode.value)
})
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
    <template v-if="isOpeningRoom">
      <h1
        id="main-heading"
        tabindex="-1"
        class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        {{ t('room.opening', { code: routeCode }) }}
      </h1>
    </template>

    <template v-else-if="resumeState === 'not-seated'">
      <h1
        id="main-heading"
        tabindex="-1"
        class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        {{ t('room.notSeated.heading') }}
      </h1>
      <p class="text-muted-foreground">{{ t('room.notSeated.body') }}</p>
      <RouterLink
        :to="{ name: 'home', query: { code: routeCode } }"
        class="text-primary underline underline-offset-4"
      >
        {{ t('room.notSeated.join', { code: routeCode }) }}
      </RouterLink>
    </template>

    <template v-else-if="!hasActiveGame">
      <h1
        id="main-heading"
        tabindex="-1"
        class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        {{ t('room.empty.heading') }}
      </h1>
      <p class="text-muted-foreground">{{ t('room.empty.body') }}</p>
      <RouterLink :to="{ name: 'home' }" class="text-primary underline underline-offset-4">
        {{ t('room.empty.backHome') }}
      </RouterLink>
    </template>

    <template v-else>
      <h1
        id="main-heading"
        tabindex="-1"
        class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        {{ t('room.heading') }}
      </h1>

      <p
        v-if="isOnline"
        class="bg-muted text-foreground border-border rounded-lg border px-4 py-3 text-sm"
      >
        <span class="font-semibold">{{
          t('room.online.codeLabel', { code: roomCode ?? '' })
        }}</span>
        <br />
        <span class="text-muted-foreground">{{ t('room.online.codeHint') }}</span>
      </p>
      <p
        v-if="isOnline && isReconnecting"
        role="status"
        class="bg-muted text-foreground border-border flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
      >
        <WifiOff aria-hidden="true" class="size-4 shrink-0" />
        {{ t('room.online.reconnecting') }}
      </p>
      <p
        v-else-if="!isOnline"
        role="status"
        class="bg-muted text-foreground border-border flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
      >
        <WifiOff aria-hidden="true" class="size-4 shrink-0" />
        {{ t('room.offline.banner') }}
      </p>

      <p
        v-if="connectionError"
        role="alert"
        class="bg-muted text-foreground border-border flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
      >
        <WifiOff aria-hidden="true" class="size-4 shrink-0" />
        {{
          connectionError === 'removed' ? t('room.connection.removed') : t('room.connection.lost')
        }}
      </p>

      <ContractBanner :round="currentRound" :contract-key="currentContract.contractKey" />

      <ScoreBoard :standings="standings" :show-leader="completedRounds > 0" />

      <WinnerBanner v-if="isFinished" :winners="winners" />

      <section
        v-if="!isFinished && missedRoundCards.length > 0"
        aria-labelledby="missed-rounds-heading"
        class="flex flex-col gap-2"
      >
        <h2 id="missed-rounds-heading" class="text-lg font-semibold">
          {{ t('room.score.missedHeading') }}
        </h2>
        <p class="text-muted-foreground text-sm">{{ t('room.score.missedHint') }}</p>
        <ul role="list" class="flex flex-col gap-3">
          <ScoreCard
            v-for="card in missedRoundCards"
            :key="`${card.player.id}-${card.round}`"
            :player="card.player"
            :round="card.round"
            :is-own-card="isOwnCard(card.player.id)"
            is-missed-round
            @commit="handleScoreCommit"
          />
        </ul>
      </section>

      <section v-if="!isFinished" aria-labelledby="score-entry-heading" class="flex flex-col gap-2">
        <h2
          id="score-entry-heading"
          ref="scoreEntryHeading"
          tabindex="-1"
          class="focus-visible:ring-ring rounded-sm text-lg font-semibold focus-visible:ring-2 focus-visible:outline-none"
        >
          {{ t('room.score.sectionHeading', { round: n(currentRound) }) }}
        </h2>
        <!-- role="list": Tailwind's list reset makes Safari/VoiceOver drop <ul> semantics. -->
        <ul role="list" class="flex flex-col gap-3">
          <ScoreCard
            v-for="standing in entryStandings"
            :key="`${standing.player.id}-${currentRound}`"
            :player="standing.player"
            :round="currentRound"
            :scored-points="pointsFor(standing.player.id, currentRound, roundScores)"
            :show-points="canSeePoints(standing.player.id, currentRound)"
            :is-own-card="isOwnCard(standing.player.id)"
            :can-use-photo-count="isOnline && standing.player.id === myPlayerId"
            :room-code="roomCode"
            @commit="handleScoreCommit"
          >
            <template v-if="canRemove(standing.player.id)" #actions>
              <RemovePlayerControl
                :player-name="standing.player.name"
                @remove="handleRemovePlayer(standing.player)"
              />
            </template>
          </ScoreCard>
        </ul>
      </section>

      <p v-if="saveError" role="alert" class="text-destructive text-sm">{{ saveError }}</p>

      <div aria-live="polite" class="sr-only">{{ announcement }}</div>

      <div v-if="isHost" class="bg-background sticky bottom-0 mt-auto flex gap-2 pt-2 pb-2">
        <Button
          v-if="!isFinalRound"
          class="h-11 flex-1"
          :disabled="!allPlayersScored || isAdvancing"
          @click="handleNextRound"
        >
          {{ t('room.next.button') }}
        </Button>
        <Button
          v-else-if="!isFinished"
          class="h-11 flex-1"
          :disabled="!allPlayersScored || isFinishing"
          @click="handleFinish"
        >
          {{ t('room.finish.button') }}
        </Button>
      </div>
      <p
        v-else-if="!isFinished"
        role="status"
        class="text-muted-foreground py-2 text-center text-sm"
      >
        {{ t('room.online.waitingForHost') }}
      </p>
    </template>
  </main>
</template>
