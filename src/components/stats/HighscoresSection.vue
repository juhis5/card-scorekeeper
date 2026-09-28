<script setup lang="ts">
/**
 * Single job: the Stats screen's global highscores, in two tabs: player lists and game records.
 * It has its own loading and error states, so a failure never hides this device's stats above it.
 */
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import HighscoreList, { type HighscoreValueKind } from '@/components/stats/HighscoreList.vue'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { QUALIFYING_GAMES } from '@/lib/game/stats'
import { useHighscoresStore, type HighscoreListName } from '@/stores/highscores'

interface ListView {
  name: HighscoreListName
  kind: HighscoreValueKind
  /** The key of the value column's heading. */
  header: string
}

const GROUPS: { id: 'players' | 'games'; lists: ListView[] }[] = [
  {
    id: 'players',
    lists: [
      { name: 'mostWins', kind: 'count', header: 'wins' },
      { name: 'bestWinRate', kind: 'percent', header: 'winRate' },
      { name: 'bestAverage', kind: 'average', header: 'average' },
      { name: 'mostGames', kind: 'count', header: 'games' },
    ],
  },
  {
    id: 'games',
    lists: [
      { name: 'bestGames', kind: 'count', header: 'points' },
      { name: 'worstGames', kind: 'count', header: 'points' },
      { name: 'biggestRounds', kind: 'count', header: 'points' },
    ],
  },
]

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
    <Tabs v-else default-value="players" class="gap-4">
      <TabsList class="grid h-11 w-full grid-cols-2">
        <TabsTrigger v-for="group in GROUPS" :key="group.id" :value="group.id" class="h-9">
          {{ t(`stats.highscores.tabs.${group.id}`) }}
        </TabsTrigger>
      </TabsList>
      <TabsContent
        v-for="group in GROUPS"
        :key="group.id"
        :value="group.id"
        class="flex flex-col gap-4"
      >
        <HighscoreList
          v-for="list in group.lists"
          :id="`highscores-${list.name}`"
          :key="list.name"
          :title="t(`stats.highscores.lists.${list.name}.title`)"
          :description="
            t(`stats.highscores.lists.${list.name}.description`, { min: QUALIFYING_GAMES })
          "
          :value-header="t(`stats.highscores.columns.${list.header}`)"
          :value-kind="list.kind"
          :entries="lists[list.name]"
        />
      </TabsContent>
    </Tabs>
  </section>
</template>
