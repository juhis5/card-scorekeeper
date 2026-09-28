<script setup lang="ts">
/** Single job: the global highscores, the player lists or the game records at a time, with its
 * own loading and error states. The page heading is HighscoresView's. */
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import HighscoreList, { type HighscoreValueKind } from '@/components/stats/HighscoreList.vue'
import { Button } from '@/components/ui/button'
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue'
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

/** Lists with their own reason for being empty: nobody has won, or played enough games. */
function emptyTextFor(name: HighscoreListName): string | undefined {
  if (name === 'mostWins') return t('stats.highscores.emptyWins')
  if (name === 'bestWinRate' || name === 'bestAverage') {
    return t('stats.highscores.emptyQualified', { min: QUALIFYING_GAMES })
  }
  return undefined
}
const shownGroup = ref<(typeof GROUPS)[number]['id']>('players')
const groupOptions = computed(() =>
  GROUPS.map((group) => ({ value: group.id, label: t(`stats.highscores.tabs.${group.id}`) })),
)
const shownLists = computed(
  () => GROUPS.find((group) => group.id === shownGroup.value)?.lists ?? [],
)
const { status, lists } = storeToRefs(highscores)

onMounted(() => {
  void highscores.load()
})
</script>

<template>
  <div class="flex flex-col gap-4">
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
      <SegmentedToggle
        v-model="shownGroup"
        :label="t('stats.highscores.heading')"
        :options="groupOptions"
      />
      <HighscoreList
        v-for="list in shownLists"
        :id="`highscores-${list.name}`"
        :key="list.name"
        :title="t(`stats.highscores.lists.${list.name}.title`)"
        :description="
          t(`stats.highscores.lists.${list.name}.description`, { min: QUALIFYING_GAMES })
        "
        :value-header="t(`stats.highscores.columns.${list.header}`)"
        :value-kind="list.kind"
        :entries="lists[list.name]"
        :empty-text="emptyTextFor(list.name)"
      />
    </template>
  </div>
</template>
