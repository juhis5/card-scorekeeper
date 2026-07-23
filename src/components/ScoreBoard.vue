<script setup lang="ts">
/** Single job: render standings as a real, sorted <table> with the leader marked by icon + text. */
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

const { standings } = defineProps<{ standings: Standing[] }>()

const { t, n } = useI18n()
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
        :class="standing.placement === 1 ? 'bg-muted' : undefined"
      >
        <TableCell>
          <div class="flex items-center gap-2">
            <Crown
              v-if="standing.placement === 1"
              aria-hidden="true"
              class="text-primary size-4 shrink-0"
            />
            <span>{{ standing.player.name }}</span>
            <span v-if="standing.placement === 1" class="text-primary text-xs font-medium">
              {{ t('room.table.leaderLabel') }}
            </span>
          </div>
        </TableCell>
        <TableCell class="text-right font-semibold">{{ n(standing.total) }}</TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
