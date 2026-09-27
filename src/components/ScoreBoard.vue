<script setup lang="ts">
/**
 * Single job: render the board rows (see lib/scoreboard.ts) as a real, sorted <table>. Five
 * narrow round columns before the total: revealed rounds show numbers, the round in progress only
 * shows who has entered. The leader is marked by an icon plus screen-reader text, never color
 * alone, and only once a round is complete: at the start everyone ties at 0.
 *
 * Rows slide to their new places when a round is revealed (a FLIP move via TransitionGroup), and
 * a changed total fades in. Both are switched off for reduced motion in main.css.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Crown } from '@lucide/vue'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CONTRACTS, TOTAL_ROUNDS } from '@/lib/rules'
import type { BoardRow } from '@/lib/scoreboard'

const { rows, completedRounds } = defineProps<{
  rows: BoardRow[]
  completedRounds: number
}>()

const { t, n } = useI18n()

const rounds = CONTRACTS.map((contract) => contract.round)
const roundInProgress = computed(() =>
  completedRounds < TOTAL_ROUNDS ? completedRounds + 1 : null,
)

function isLeader(row: BoardRow): boolean {
  return completedRounds > 0 && row.placement === 1
}
</script>

<template>
  <Table class="table-fixed">
    <caption v-if="completedRounds > 0" class="sr-only">
      {{
        t('room.table.caption', { round: n(completedRounds) })
      }}
    </caption>
    <colgroup>
      <col />
      <col v-for="round in rounds" :key="round" class="w-8" />
      <col class="w-12" />
    </colgroup>
    <TableHeader>
      <TableRow>
        <TableHead scope="col" class="h-8">{{ t('room.table.player') }}</TableHead>
        <TableHead
          v-for="round in rounds"
          :key="round"
          scope="col"
          class="h-8 px-0 text-center text-xs tabular-nums"
          :class="round === roundInProgress ? 'text-primary' : 'text-muted-foreground'"
        >
          <span aria-hidden="true">{{ n(round) }}</span>
          <span class="sr-only">{{ t('room.table.roundHeader', { round: n(round) }) }}</span>
        </TableHead>
        <TableHead scope="col" class="h-8 pl-0 text-right">
          <span aria-hidden="true">{{ t('room.table.totalShort') }}</span>
          <span class="sr-only">{{ t('room.table.total') }}</span>
        </TableHead>
      </TableRow>
    </TableHeader>
    <TransitionGroup tag="tbody" name="board-row" class="[&_tr:last-child]:border-0">
      <TableRow
        v-for="row in rows"
        :key="row.player.id"
        :class="isLeader(row) ? 'bg-muted' : undefined"
      >
        <th scope="row" class="px-2 py-1.5 text-left align-middle font-normal">
          <div class="flex min-w-0 items-center gap-2">
            <Crown v-if="isLeader(row)" aria-hidden="true" class="text-primary size-4 shrink-0" />
            <span class="truncate">{{ row.player.name }}</span>
            <span
              v-if="row.player.isGuest"
              class="bg-muted text-muted-foreground shrink-0 rounded-full px-2 text-xs"
            >
              {{ t('room.guest') }}
            </span>
            <span v-if="isLeader(row)" class="sr-only">{{ t('room.table.leaderLabel') }}</span>
          </div>
        </th>
        <TableCell
          v-for="(cell, index) in row.cells"
          :key="index"
          class="text-muted-foreground px-0 py-1.5 text-center text-xs tabular-nums"
        >
          <template v-if="cell.kind === 'points'">
            {{ n(cell.points, { useGrouping: false }) }}
          </template>
          <template v-else-if="cell.kind === 'entered'">
            <Check aria-hidden="true" class="text-primary mx-auto size-3.5" />
            <span class="sr-only">{{ t('room.table.entered') }}</span>
          </template>
          <template v-else>
            <span aria-hidden="true">–</span>
            <span class="sr-only">{{ t('room.table.noScore') }}</span>
          </template>
        </TableCell>
        <TableCell class="py-1.5 pl-0 text-right font-semibold tabular-nums">
          <Transition name="board-total" mode="out-in">
            <span :key="row.total" class="inline-block">{{ n(row.total) }}</span>
          </Transition>
        </TableCell>
      </TableRow>
    </TransitionGroup>
  </Table>
</template>
