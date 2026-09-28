<script setup lang="ts">
/**
 * This device's record and head-to-head per opponent. The identity caveats sit behind the ⓘ by
 * the heading whatever the load state, since they apply either way. Highscores have their own page.
 */
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import InfoPopover from '@/components/shared/InfoPopover.vue'
import HeadToHeadList from '@/components/stats/HeadToHeadList.vue'
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
    <div class="flex items-center justify-between gap-2">
      <h1
        id="main-heading"
        tabindex="-1"
        class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        {{ t('stats.heading') }}
      </h1>
      <InfoPopover :label="t('stats.caveats.heading')" :text="t('stats.caveats.body')" />
    </div>

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
  </main>
</template>
