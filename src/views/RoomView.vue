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
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'
import { WifiOff } from '@lucide/vue'
import ContractBanner from '@/components/ContractBanner.vue'
import ScoreCard from '@/components/ScoreCard.vue'
import ScoreBoard from '@/components/ScoreBoard.vue'
import WinnerBanner from '@/components/WinnerBanner.vue'
import { Button } from '@/components/ui/button'
import { useConnectionStatus } from '@/composables/useConnectionStatus'
import { LOCAL_GAME_ROUTE_CODE } from '@/lib/local-game-route'
import { TOTAL_ROUNDS } from '@/lib/rules'
import { useGameStore } from '@/stores/game'
import type { PlayerId } from '@/lib/repository'
import type { Standing } from '@/lib/types'

const { t, n } = useI18n()
const route = useRoute()
const game = useGameStore()
const {
  standings,
  currentContract,
  currentRound,
  status,
  winners,
  roundScores,
  isHost,
  myPlayerId,
  isOnline,
  roomCode,
} = storeToRefs(game)
// Mid-game connectivity blip, distinct from the never-connected `!isOnline` banner below (see
// the error-ux skill's "the two offline modes") — only ever shown while `isOnline` (a live room).
const { isReconnecting } = useConnectionStatus()

const announcement = ref('')
const isAdvancing = ref(false)
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
const entryStandings = computed(() => {
  const ordered = seatOrder.value
    .map((playerId) => standings.value.find((standing) => standing.player.id === playerId))
    .filter((standing): standing is Standing => standing !== undefined)
  // Online, host-editing-others is deferred (see DECISIONS.md) — every device, host included,
  // edits only its own seat; offline, the host still enters everyone's score as today.
  return isOnline.value
    ? ordered.filter((standing) => standing.player.id === myPlayerId.value)
    : ordered
})

const hasActiveGame = computed(() => standings.value.length > 0)
const isFinalRound = computed(() => currentRound.value === TOTAL_ROUNDS)
const isFinished = computed(() => status.value === 'finished')
// Derived from synced `roundScores`, not view-local commits: online, only this device's own row
// is ever committed here, so a view-local "who did I just commit" set would never see the other
// seats' scores and the Next/Finish gate could never open. `roundScores` is the shared source of
// truth for both modes (see repository.ts).
const scoredPlayerIdsThisRound = computed(
  () =>
    new Set(
      roundScores.value
        .filter((score) => score.round === currentRound.value)
        .map((score) => score.playerId),
    ),
)
const allPlayersScored = computed(() =>
  standings.value.every((standing) => scoredPlayerIdsThisRound.value.has(standing.player.id)),
)

async function handleScoreCommit(playerId: PlayerId, points: number): Promise<void> {
  await game.setRoundScore({ playerId, round: currentRound.value, points })

  const player = standings.value.find((standing) => standing.player.id === playerId)?.player
  if (!player) return

  const isLeading = standings.value[0]?.player.id === playerId
  announcement.value = isLeading
    ? t('room.live.scoreEnteredLeading', { name: player.name, points: n(points) })
    : t('room.live.scoreEntered', { name: player.name, points: n(points) })
}

async function handleNextRound(): Promise<void> {
  isAdvancing.value = true
  try {
    await game.advanceRound()
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
  } finally {
    isFinishing.value = false
  }
}

// Slice 5 offline robustness: a hard reload mid-LOCAL-game used to lose the in-memory store
// entirely (repo data survived in localStorage, nothing read it back) — RoomView showed the empty
// state even though a game was still there to continue. Gated on BOTH "no active game yet" AND
// the route actually being the local sentinel: without the route check, reloading a real ONLINE
// room (`/room/<code>`) — also a fresh, game-less store at that point — would resume any stale
// LOCAL game left in localStorage from an earlier session and silently show the wrong game
// instead of the online room the URL asked for. Resuming an online room is a different problem
// (Firestore reconnect, not this), not something `resume()` does at all.
onMounted(() => {
  if (!hasActiveGame.value && route.params.code === LOCAL_GAME_ROUTE_CODE) {
    game.resume()
  }
})
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
    <template v-if="!hasActiveGame">
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

      <ContractBanner :round="currentRound" :contract-key="currentContract.contractKey" />

      <ScoreBoard :standings="standings" />

      <WinnerBanner v-if="isFinished" :winners="winners" />

      <section v-else aria-labelledby="score-entry-heading" class="flex flex-col gap-2">
        <h2 id="score-entry-heading" class="text-lg font-semibold">
          {{ t('room.score.sectionHeading', { round: n(currentRound) }) }}
        </h2>
        <!-- role="list": Tailwind's list reset makes Safari/VoiceOver drop <ul> semantics. -->
        <ul role="list" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ScoreCard
            v-for="standing in entryStandings"
            :key="`${standing.player.id}-${currentRound}`"
            :player="standing.player"
            :round="currentRound"
            :is-scored="scoredPlayerIdsThisRound.has(standing.player.id)"
            :can-use-photo-count="isOnline && standing.player.id === myPlayerId"
            :room-code="roomCode"
            @commit="handleScoreCommit"
          />
        </ul>
      </section>

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
