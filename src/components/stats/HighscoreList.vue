<script setup lang="ts">
/**
 * Single job: one highscore list as a table. This device's own entries say "you" in words, not
 * only by color. Game records show the date; player lists show how many games a total covers.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { HighscoreEntry } from '@/stores/highscores'

export type HighscoreValueKind = 'count' | 'percent' | 'average'

const {
  id,
  title,
  description,
  valueHeader,
  valueKind = 'count',
  entries,
  emptyText,
} = defineProps<{
  id: string
  title: string
  description: string
  valueHeader: string
  valueKind?: HighscoreValueKind
  entries: HighscoreEntry[]
  /** Said when the list is empty; "no games yet" unless the list has a reason of its own. */
  emptyText?: string
}>()

const { t, locale } = useI18n()

const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'numeric', year: 'numeric' }),
)
const valueFormat = computed(
  () =>
    new Intl.NumberFormat(locale.value, {
      style: valueKind === 'percent' ? 'percent' : 'decimal',
      maximumFractionDigits: valueKind === 'average' ? 1 : 0,
    }),
)
const countFormat = computed(() => new Intl.NumberFormat(locale.value))
</script>

<template>
  <section :aria-labelledby="`${id}-heading`" class="flex flex-col gap-1">
    <h2 :id="`${id}-heading`" class="font-semibold">{{ title }}</h2>
    <p class="text-muted-foreground text-sm">{{ description }}</p>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col" class="w-8">{{ t('stats.highscores.rank') }}</TableHead>
          <TableHead scope="col">{{ t('stats.highscores.player') }}</TableHead>
          <TableHead scope="col" class="text-right">{{ valueHeader }}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableEmpty v-if="entries.length === 0" :colspan="3">
          {{ emptyText ?? t('stats.highscores.empty') }}
        </TableEmpty>
        <TableRow v-for="entry in entries" :key="entry.id" :class="{ 'bg-muted': entry.isMine }">
          <TableCell class="text-muted-foreground tabular-nums">
            {{ countFormat.format(entry.rank) }}
          </TableCell>
          <TableCell class="whitespace-normal">
            <span class="font-medium">{{ entry.displayName }}</span>
            <span v-if="entry.isMine" class="text-primary text-sm">
              · {{ t('stats.highscores.you') }}
            </span>
            <span v-if="entry.finishedAt" class="text-muted-foreground block text-xs">
              {{ dateFormat.format(new Date(entry.finishedAt)) }}
            </span>
            <span v-else-if="entry.gamesPlayed" class="text-muted-foreground block text-xs">
              {{
                t(
                  'stats.highscores.games',
                  { count: countFormat.format(entry.gamesPlayed) },
                  entry.gamesPlayed,
                )
              }}
            </span>
          </TableCell>
          <TableCell class="text-right font-semibold tabular-nums">
            {{ valueFormat.format(entry.value) }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </section>
</template>
