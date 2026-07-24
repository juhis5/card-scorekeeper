<script setup lang="ts">
/**
 * Renders this device's PlayerStats as a labelled grid of stat tiles: games played, wins + win
 * rate, best/worst final score, best/worst single round, average final score (see docs/PLAN.md
 * "Stats tracked"). No charts here — deferred to polish (see the slice-6-ui delegation brief); a
 * `<dl>` grid of tiles is the deliverable.
 */
import { useI18n } from 'vue-i18n'
import StatTile from './StatTile.vue'
import type { PlayerStats } from '@/lib/stats'

const { stats } = defineProps<{ stats: PlayerStats }>()

const { t, n } = useI18n()

/** `null` only ever means "no games yet" (see PlayerStats's doc comment) — `stats.gamesPlayed`
 * is always > 0 by the time this component renders (StatsView only shows it once `loaded`). */
function formatScore(value: number | null): string {
  return value === null ? t('stats.summary.noValue') : n(value)
}
</script>

<template>
  <section aria-labelledby="stats-summary-heading" class="flex flex-col gap-2">
    <h2 id="stats-summary-heading" class="text-lg font-semibold">
      {{ t('stats.summary.heading') }}
    </h2>
    <dl class="grid grid-cols-2 gap-2">
      <StatTile :label="t('stats.summary.gamesPlayed')" :value="n(stats.gamesPlayed)" />
      <StatTile :label="t('stats.summary.wins')" :value="n(stats.wins)" />
      <StatTile
        :label="t('stats.summary.winRate')"
        :value="n(stats.winRate, { style: 'percent', maximumFractionDigits: 0 })"
      />
      <StatTile
        :label="t('stats.summary.averageFinalScore')"
        :value="
          stats.averageFinalScore === null
            ? t('stats.summary.noValue')
            : n(stats.averageFinalScore, { maximumFractionDigits: 1 })
        "
      />
      <StatTile
        :label="t('stats.summary.bestFinalScore')"
        :value="formatScore(stats.bestFinalScore)"
      />
      <StatTile
        :label="t('stats.summary.worstFinalScore')"
        :value="formatScore(stats.worstFinalScore)"
      />
      <StatTile :label="t('stats.summary.bestRound')" :value="formatScore(stats.bestRound)" />
      <StatTile :label="t('stats.summary.worstRound')" :value="formatScore(stats.worstRound)" />
    </dl>
  </section>
</template>
