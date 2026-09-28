<script setup lang="ts">
/**
 * This device's record, head-to-head per opponent, then the global highscores. The identity
 * caveats show whatever the load state, since they apply either way.
 */
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import HeadToHeadList from '@/components/stats/HeadToHeadList.vue'
import HighscoresSection from '@/components/stats/HighscoresSection.vue'
import ResultQueueNotice from '@/components/stats/ResultQueueNotice.vue'
import StatSummary from '@/components/stats/StatSummary.vue'
import { Button } from '@/components/ui/button'
import { useResultQueueStore } from '@/stores/result-queue'
import { useStatsStore } from '@/stores/stats'

const { t } = useI18n()
const statsStore = useStatsStore()
const { status, stats, opponents } = storeToRefs(statsStore)
const resultQueue = useResultQueueStore()

async function uploadQueuedGames(): Promise<void> {
  if ((await resultQueue.upload()) > 0) void statsStore.load()
}

onMounted(() => {
  void statsStore.load()
  void uploadQueuedGames()
})
</script>

<template>
  <main class="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
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

    <ResultQueueNotice @uploaded="statsStore.load()" />

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

    <HighscoresSection />
  </main>
</template>
