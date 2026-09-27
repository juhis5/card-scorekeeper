<script setup lang="ts">
/**
 * The head-to-head record list: one row per opponent this device has shared a finished game
 * with, showing their most-recently-used displayName (see `useStatsStore`'s doc comment — a
 * `GamePlayer` row carries no timestamp, so recency comes from the matching `game_result`) and
 * the W-L-T record. A real `<table>` — this is tabular data (a11y-mobile: right element for the
 * shape), not a hand-rolled chart (charts are explicitly deferred to polish, see the delegation
 * brief).
 */
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
import type { OpponentRecord } from '@/stores/stats'

const { opponents } = defineProps<{ opponents: OpponentRecord[] }>()

const { t, n } = useI18n()
</script>

<template>
  <section aria-labelledby="stats-h2h-heading" class="flex flex-col gap-2">
    <h2 id="stats-h2h-heading" class="text-lg font-semibold">
      {{ t('stats.headToHead.heading') }}
    </h2>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{{ t('stats.headToHead.opponent') }}</TableHead>
          <TableHead scope="col" class="text-right">
            {{ t('stats.headToHead.recordHeader') }}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableEmpty v-if="opponents.length === 0" :colspan="2">
          {{ t('stats.headToHead.empty') }}
        </TableEmpty>
        <TableRow v-for="opponent in opponents" :key="opponent.opponentDeviceUuid">
          <TableCell>{{ opponent.displayName }}</TableCell>
          <TableCell class="text-right">
            {{
              t('stats.headToHead.recordCompact', {
                wins: n(opponent.record.wins),
                losses: n(opponent.record.losses),
                ties: n(opponent.record.ties),
              })
            }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </section>
</template>
