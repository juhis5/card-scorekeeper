<script setup lang="ts">
/**
 * Single job: the Stats screen's global highscores (fourth round), with its own loading and error
 * states, so it never hides this device's stats above it: best games, the hall of shame and the
 * biggest rounds, across every game played with the app.
 */
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import HighscoreList from '@/components/stats/HighscoreList.vue'
import { Button } from '@/components/ui/button'
import { useHighscoresStore, type HighscoreListName } from '@/stores/highscores'

const LISTS: HighscoreListName[] = ['bestGames', 'worstGames', 'biggestRounds']

const { t } = useI18n()
const highscores = useHighscoresStore()
const { status, lists } = storeToRefs(highscores)

onMounted(() => {
  void highscores.load()
})
</script>

<template>
  <section aria-labelledby="highscores-heading" class="flex flex-col gap-4">
    <div>
      <h2 id="highscores-heading" class="text-lg font-semibold">
        {{ t('stats.highscores.heading') }}
      </h2>
      <p class="text-muted-foreground text-sm">{{ t('stats.highscores.lede') }}</p>
    </div>
    <p v-if="status === 'loading'" role="status" class="text-muted-foreground text-sm">
      {{ t('stats.highscores.loading') }}
    </p>
    <div v-else-if="status === 'error'" class="flex flex-col items-start gap-2">
      <p role="alert" class="text-destructive text-sm">{{ t('stats.highscores.error') }}</p>
      <Button variant="outline" class="h-11" @click="highscores.load()">
        {{ t('stats.error.retry') }}
      </Button>
    </div>
    <template v-else>
      <HighscoreList
        v-for="list in LISTS"
        :id="`highscores-${list}`"
        :key="list"
        :title="t(`stats.highscores.lists.${list}.title`)"
        :description="t(`stats.highscores.lists.${list}.description`)"
        :entries="lists[list]"
      />
    </template>
  </section>
</template>
