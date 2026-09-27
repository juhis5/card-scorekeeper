<script setup lang="ts">
/** Single job: render standings as a real, sorted <table> with the leader marked by icon + text.
 * No leader until a round is complete: at the start everyone ties at 0, and marking all of them
 * says nothing. */
import { useI18n } from 'vue-i18n'
import { Crown } from '@lucide/vue'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Standing } from '@/lib/types'

const { standings, showLeader = false } = defineProps<{
  standings: Standing[]
  showLeader?: boolean
}>()

const { t, n } = useI18n()

function isLeader(standing: Standing): boolean {
  return showLeader && standing.placement === 1
}
</script>

<template>
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead scope="col">{{ t('room.table.player') }}</TableHead>
        <TableHead scope="col" class="text-right">{{ t('room.table.total') }}</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow
        v-for="standing in standings"
        :key="standing.player.id"
        :class="isLeader(standing) ? 'bg-muted' : undefined"
      >
        <TableCell>
          <div class="flex items-center gap-2">
            <Crown
              v-if="isLeader(standing)"
              aria-hidden="true"
              class="text-primary size-4 shrink-0"
            />
            <span>{{ standing.player.name }}</span>
            <span v-if="isLeader(standing)" class="text-primary text-xs font-medium">
              {{ t('room.table.leaderLabel') }}
            </span>
          </div>
        </TableCell>
        <TableCell class="text-right font-semibold">{{ n(standing.total) }}</TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
