<script setup lang="ts">
/**
 * Single job: the head-to-head table, one row per opponent from a shared finished game, with their
 * latest display name (see `useStatsStore`) and W-L-T record.
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
import ClaimedBadge from '@/components/shared/ClaimedBadge.vue'
import InfoPopover from '@/components/shared/InfoPopover.vue'
import type { OpponentRecord } from '@/stores/stats'

const { opponents, claimedPlayerIds = new Set() } = defineProps<{
  opponents: OpponentRecord[]
  /** Opponents shown under the name they claimed: they get the badge. */
  claimedPlayerIds?: ReadonlySet<string>
}>()

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
            <span class="inline-flex items-center justify-end gap-1">
              {{ t('stats.headToHead.recordHeader') }}
              <InfoPopover
                :label="t('stats.headToHead.legendLabel')"
                :text="t('stats.headToHead.legend')"
              />
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableEmpty v-if="opponents.length === 0" :colspan="2">
          {{ t('stats.headToHead.empty') }}
        </TableEmpty>
        <TableRow v-for="opponent in opponents" :key="opponent.opponentDeviceUuid">
          <TableCell>
            {{ opponent.displayName }}
            <ClaimedBadge
              v-if="claimedPlayerIds.has(opponent.opponentDeviceUuid)"
              class="ml-1 align-text-bottom"
            />
          </TableCell>
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
