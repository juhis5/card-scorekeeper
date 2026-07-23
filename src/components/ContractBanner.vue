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
  <!-- `role="status"` is an implicit polite live region: when the round advances, this text
       changes and is announced on its own — no separate manual announcement needed. -->
  <p
    role="status"
    class="bg-muted text-foreground border-border rounded-lg border px-4 py-3 text-base font-medium"
  >
    {{
      t('room.roundBanner', { round: n(round), total: n(TOTAL_ROUNDS), contract: t(contractKey) })
    }}
  </p>
</template>
