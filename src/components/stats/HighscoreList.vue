<script setup lang="ts">
/**
 * Single job: one highscore list as a table. This device's own entries say "you" in words, not
 * only by color.
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

const { id, title, description, entries } = defineProps<{
  id: string
  title: string
  description: string
  entries: HighscoreEntry[]
}>()

const { t, n, locale } = useI18n()

const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'numeric', year: 'numeric' }),
)
</script>

<template>
  <section :aria-labelledby="`${id}-heading`" class="flex flex-col gap-1">
    <h3 :id="`${id}-heading`" class="font-semibold">{{ title }}</h3>
    <p class="text-muted-foreground text-sm">{{ description }}</p>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col" class="w-8">{{ t('stats.highscores.rank') }}</TableHead>
          <TableHead scope="col">{{ t('stats.highscores.player') }}</TableHead>
          <TableHead scope="col" class="text-right">{{ t('stats.highscores.points') }}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableEmpty v-if="entries.length === 0" :colspan="3">
          {{ t('stats.highscores.empty') }}
        </TableEmpty>
        <TableRow v-for="entry in entries" :key="entry.id" :class="{ 'bg-muted': entry.isMine }">
          <TableCell class="text-muted-foreground tabular-nums">{{ n(entry.rank) }}</TableCell>
          <TableCell class="whitespace-normal">
            <span class="font-medium">{{ entry.displayName }}</span>
            <span v-if="entry.isMine" class="text-primary text-sm">
              · {{ t('stats.highscores.you') }}
            </span>
            <span class="text-muted-foreground block text-xs">
              {{ dateFormat.format(new Date(entry.finishedAt)) }}
            </span>
          </TableCell>
          <TableCell class="text-right font-semibold tabular-nums">{{ n(entry.points) }}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </section>
</template>
