<script setup lang="ts">
/** Single job: the "Round X of 5" banner, with its contract, for the round in progress. */
import { useI18n } from 'vue-i18n'
import { TOTAL_ROUNDS } from '@/lib/game/rules'
import type { ContractKey, ContractRoundNumber } from '@/lib/game/types'

const { round, contractKey } = defineProps<{
  round: ContractRoundNumber
  contractKey: ContractKey
}>()

const { t, n } = useI18n()
</script>

<template>
  <!-- Not a live region: RoomView announces the new round together with the results. -->
  <p class="bg-muted text-foreground border-border rounded-lg border px-3 py-2 text-sm font-medium">
    {{
      t('room.roundBanner', { round: n(round), total: n(TOTAL_ROUNDS), contract: t(contractKey) })
    }}
  </p>
</template>
