<script setup lang="ts">
/**
 * The persistent Stats screen (see docs/PLAN.md "Stats & history"): this device's own record —
 * games played, wins/win rate, best/worst final score, best/worst single round, average final
 * score — plus a head-to-head list per opponent. Pure read-side UI: all math and Firestore I/O
 * live in `useStatsStore`; this view only renders its four states (see the error-ux skill) and
 * always surfaces the identity caveats (docs/PLAN.md's "Stats & history" failure modes), since
 * they apply regardless of whether the load itself succeeded.
 */
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import HeadToHeadList from '@/components/HeadToHeadList.vue'
import StatSummary from '@/components/StatSummary.vue'
import { Button } from '@/components/ui/button'
import { useStatsStore } from '@/stores/stats'

const { t } = useI18n()
const statsStore = useStatsStore()
const { status, stats, opponents } = storeToRefs(statsStore)

onMounted(() => {
  void statsStore.load()
})
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 p-4">
    <h1
      id="main-heading"
      tabindex="-1"
      class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
    >
      {{ t('stats.heading') }}
    </h1>

    <section
      aria-labelledby="stats-caveats-heading"
      class="bg-muted border-border rounded-lg border px-4 py-3 text-sm"
    >
      <h2 id="stats-caveats-heading" class="font-semibold">{{ t('stats.caveats.heading') }}</h2>
      <p class="text-muted-foreground mt-1">{{ t('stats.caveats.body') }}</p>
    </section>

    <p v-if="status === 'loading'" role="status" class="text-muted-foreground text-sm">
      {{ t('stats.loading') }}
    </p>

    <p v-else-if="status === 'empty'" role="status" class="text-muted-foreground text-sm">
      {{ t('stats.empty.message') }}
    </p>

    <div v-else-if="status === 'error'" class="flex flex-col items-start gap-2">
      <p role="alert" class="text-destructive text-sm">{{ t('stats.error.message') }}</p>
      <Button variant="outline" class="h-11" @click="statsStore.load()">
        {{ t('stats.error.retry') }}
      </Button>
    </div>

    <template v-else-if="status === 'loaded'">
      <template v-if="stats">
        <StatSummary :stats="stats" />
        <HeadToHeadList :opponents="opponents" />
      </template>
    </template>
  </main>
</template>
