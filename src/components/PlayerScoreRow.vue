<script setup lang="ts">
/**
 * Single job: one player's round-score entry row — a labelled numeric input plus a "scored"
 * indicator once committed. Presentation + local draft value only; persisting the score is the
 * parent's job (it owns the store call), this just emits the validated number on commit.
 *
 * Manual entry is the golden "never fails" path (see CLAUDE.md) — so an invalid commit must
 * never be silently dropped: it's rejected with a visible, screen-reader-tied error instead.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from '@lucide/vue'
import RoundScoreInput from '@/components/RoundScoreInput.vue'
import type { ContractRoundNumber, Player } from '@/lib/types'

const {
  player,
  round,
  isScored = false,
} = defineProps<{
  player: Player
  round: ContractRoundNumber
  isScored?: boolean
}>()

const emit = defineEmits<{ commit: [playerId: string, points: number] }>()

const { t } = useI18n()
const points = ref<number | null>(null)
const errorMessage = ref('')

const inputId = computed(() => `round-score-${player.id}`)
const errorId = computed(() => `${inputId.value}-error`)
const label = computed(() => t('room.score.inputLabel', { name: player.name, round }))
const hasError = computed(() => errorMessage.value !== '')

/** A leftover-card score is always a whole, non-negative number of points. */
function isValidScore(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

function handleCommit(): void {
  if (points.value === null) {
    // Not yet typed anything — a no-op, not an error.
    errorMessage.value = ''
    return
  }
  if (!isValidScore(points.value)) {
    errorMessage.value = t('room.score.invalidError')
    return
  }
  errorMessage.value = ''
  emit('commit', player.id, points.value)
}
</script>

<template>
  <li class="flex flex-col gap-1 py-2">
    <div class="flex items-end justify-between gap-3">
      <RoundScoreInput
        :id="inputId"
        v-model="points"
        :label="label"
        :is-invalid="hasError"
        :described-by="hasError ? errorId : undefined"
        @commit="handleCommit"
      />
      <span v-if="isScored" class="text-primary flex items-center gap-1 pb-2 text-sm">
        <Check aria-hidden="true" class="size-4" />
        {{ t('room.score.scoredLabel') }}
      </span>
    </div>
    <p v-if="hasError" :id="errorId" role="alert" class="text-destructive text-sm">
      {{ errorMessage }}
    </p>
  </li>
</template>
