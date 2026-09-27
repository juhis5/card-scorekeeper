<script setup lang="ts">
/** Single job: display "Round X of 5 — <contract text>" for the round in progress. */
import { useI18n } from 'vue-i18n'
import { TOTAL_ROUNDS } from '@/lib/rules'
import type { ContractKey, ContractRoundNumber } from '@/lib/types'

const { round, contractKey } = defineProps<{
  round: ContractRoundNumber
  contractKey: ContractKey
}>()

const { t, n } = useI18n()
</script>

<template>
  <!-- Not a live region: RoomView announces the new round and its contract together with the
       revealed results, in one message. -->
  <p class="bg-muted text-foreground border-border rounded-lg border px-3 py-2 text-sm font-medium">
    {{
      t('room.roundBanner', { round: n(round), total: n(TOTAL_ROUNDS), contract: t(contractKey) })
    }}
  </p>
</template>
