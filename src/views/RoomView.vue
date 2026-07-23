<script setup lang="ts">
/**
 * The live scoreboard: contract banner, standings table, per-player round-score entry, and the
 * next-round/finish actions. Talks only to `useGameStore` — no repository, no Firestore, no
 * business logic here beyond thin UI orchestration (tracking which players have entered this
 * round's score is view-local state; the store doesn't expose per-round history — see repo.ts).
 */
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import ContractBanner from '@/components/ContractBanner.vue'
import PlayerScoreRow from '@/components/PlayerScoreRow.vue'
import ScoreBoard from '@/components/ScoreBoard.vue'
import WinnerBanner from '@/components/WinnerBanner.vue'
import { Button } from '@/components/ui/button'
import { TOTAL_ROUNDS } from '@/lib/rules'
import { useGameStore } from '@/stores/game'
import type { PlayerId } from '@/lib/repository'
import type { Standing } from '@/lib/types'

const { t, n } = useI18n()
const game = useGameStore()
const { standings, currentContract, currentRound, status, winners } = storeToRefs(game)

/** Players who have committed a score for the round in progress — reset whenever it advances.
 * Not derived from the store: `GameState` only exposes per-player running totals, not which
 * round each score belongs to (see repository.ts) — this view-local set is a display concern. */
const scoredPlayerIds = ref<Set<PlayerId>>(new Set())
const announcement = ref('')
const isAdvancing = ref(false)
const isFinishing = ref(false)

// `standings` is sorted by total, so it reorders after every commit — great for the scoreboard,
// terrible for the entry list (a row would slide out from under the host's thumb mid-entry).
// Snapshot the seat order once at mount (all totals are 0 then, so it equals join order) and
// keep the entry rows in that fixed order regardless of how the totals move.
const seatOrder = standings.value.map((standing) => standing.player.id)
const entryStandings = computed(() =>
  seatOrder
    .map((playerId) => standings.value.find((standing) => standing.player.id === playerId))
    .filter((standing): standing is Standing => standing !== undefined),
)

const hasActiveGame = computed(() => standings.value.length > 0)
const isFinalRound = computed(() => currentRound.value === TOTAL_ROUNDS)
const isFinished = computed(() => status.value === 'finished')
const allPlayersScored = computed(() =>
  standings.value.every((standing) => scoredPlayerIds.value.has(standing.player.id)),
)

watch(currentRound, () => {
  scoredPlayerIds.value = new Set()
})

async function handleScoreCommit(playerId: PlayerId, points: number): Promise<void> {
  await game.setRoundScore({ playerId, round: currentRound.value, points })
  scoredPlayerIds.value = new Set(scoredPlayerIds.value).add(playerId)

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

      <ContractBanner :round="currentRound" :contract-key="currentContract.contractKey" />

      <ScoreBoard :standings="standings" />

      <WinnerBanner v-if="isFinished" :winners="winners" />

      <section v-else aria-labelledby="score-entry-heading" class="flex flex-col gap-2">
        <h2 id="score-entry-heading" class="text-lg font-semibold">
          {{ t('room.score.sectionHeading', { round: n(currentRound) }) }}
        </h2>
        <ul class="divide-border divide-y">
          <PlayerScoreRow
            v-for="standing in entryStandings"
            :key="`${standing.player.id}-${currentRound}`"
            :player="standing.player"
            :round="currentRound"
            :is-scored="scoredPlayerIds.has(standing.player.id)"
            @commit="handleScoreCommit"
          />
        </ul>
      </section>

      <div aria-live="polite" class="sr-only">{{ announcement }}</div>

      <div class="bg-background sticky bottom-0 mt-auto flex gap-2 pt-2 pb-2">
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
    </template>
  </main>
</template>
