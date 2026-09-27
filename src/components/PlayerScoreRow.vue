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
import PhotoCountSheet from '@/components/PhotoCountSheet.vue'
import RoundScoreInput from '@/components/RoundScoreInput.vue'
import { isValidRoundScore } from '@/lib/rules'
import type { ContractRoundNumber, Player } from '@/lib/types'

const {
  player,
  round,
  isScored = false,
  canUsePhotoCount = false,
  roomCode = null,
} = defineProps<{
  player: Player
  round: ContractRoundNumber
  isScored?: boolean
  /** Gates the "Snap cards" affordance — only true when this device is online AND this is its
   * own editable row (see RoomView: photo-count is online-only, and each device only ever edits
   * its own seat). */
  canUsePhotoCount?: boolean
  roomCode?: string | null
}>()

const emit = defineEmits<{ commit: [playerId: string, points: number] }>()

const { t } = useI18n()
const points = ref<number | null>(null)
const errorMessage = ref('')

const inputId = computed(() => `round-score-${player.id}`)
const errorId = computed(() => `${inputId.value}-error`)
const label = computed(() => t('room.score.inputLabel', { name: player.name, round }))
const hasError = computed(() => errorMessage.value !== '')
const photoCountId = computed(() => `photo-count-${player.id}`)
/** `canUsePhotoCount` alone already implies `roomCode !== null` in practice (it's only ever true
 * online, and `isOnline` is derived from a non-null room code — see stores/game.ts), but this
 * checks both explicitly rather than assuming that invariant holds across a future refactor. */
const canSnapCards = computed(() => canUsePhotoCount && roomCode !== null)

/** A leftover-card score must be a non-negative integer divisible by 5. */
function isValidScore(value: number): boolean {
  return isValidRoundScore(value)
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

/** The photo is only ever a SUGGESTION (see CLAUDE.md) — confirming feeds the number through the
 * exact same commit path manual entry uses (including its validation/error display), rather than
 * writing to the store directly. */
function handlePhotoConfirm(total: number): void {
  points.value = total
  handleCommit()
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
    <PhotoCountSheet
      v-if="canSnapCards"
      :id="photoCountId"
      :room-code="roomCode ?? ''"
      @confirm="handlePhotoConfirm"
    />
    <p v-if="hasError" :id="errorId" role="alert" class="text-destructive text-sm">
      {{ errorMessage }}
    </p>
  </li>
</template>
