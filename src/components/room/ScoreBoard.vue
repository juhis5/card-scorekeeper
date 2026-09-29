<script setup lang="ts">
/**
 * Single job: the board rows (lib/game/scoreboard.ts) as a sorted <table>. The leader gets an icon
 * plus screen-reader text, not color alone, once a round is done (everyone ties at 0 before).
 * Rows slide and totals fade on reveal; main.css turns both off for reduced motion.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Crown } from '@lucide/vue'
import ClaimedBadge from '@/components/shared/ClaimedBadge.vue'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CONTRACTS, TOTAL_ROUNDS } from '@/lib/game/rules'
import type { BoardRow } from '@/lib/game/scoreboard'

const {
  rows,
  completedRounds,
  claimedPlayerIds = new Set(),
} = defineProps<{
  rows: BoardRow[]
  completedRounds: number
  /** Players shown under the name they claimed: they get the badge. */
  claimedPlayerIds?: ReadonlySet<string>
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
            <Crown v-if="isLeader(row)" aria-hidden="true" class="text-brand size-4 shrink-0" />
            <span class="truncate">{{ row.player.name }}</span>
            <ClaimedBadge v-if="claimedPlayerIds.has(row.player.id)" />
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
