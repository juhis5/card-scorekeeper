<script setup lang="ts">
/**
 * A score-entry card for one player. Collapsed by default showing the player name and score
 * status; tapping expands it inline to reveal the numeric input + photo-count affordance.
 * Replaces PlayerScoreRow's list-item layout with a tappable card that fits a responsive
 * grid (1 column on mobile, 2 on wider screens).
 *
 * Commits via the same validation path as PlayerScoreRow — invalid scores are rejected with
 * a visible, screen-reader-tied error, never silently dropped.
 */
import { computed, nextTick, ref, watch } from 'vue'
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
  canUsePhotoCount?: boolean
  roomCode?: string | null
}>()

const emit = defineEmits<{ commit: [playerId: string, points: number] }>()

const { t } = useI18n()
const points = ref<number | null>(null)
const errorMessage = ref('')
const isExpanded = ref(false)

const inputId = computed(() => `score-card-${player.id}`)
const errorId = computed(() => `${inputId.value}-error`)
const label = computed(() => t('room.score.inputLabel', { name: player.name, round }))
const hasError = computed(() => errorMessage.value !== '')
const photoCountId = computed(() => `photo-count-${player.id}`)
const canSnapCards = computed(() => canUsePhotoCount && roomCode !== null)

async function expand(): Promise<void> {
  if (isExpanded.value) return
  isExpanded.value = true
  await nextTick()
  const input = document.getElementById(inputId.value) as HTMLInputElement | null
  input?.focus()
}

function collapse(): void {
  isExpanded.value = false
  errorMessage.value = ''
}

function handleCommit(): void {
  if (points.value === null) {
    errorMessage.value = ''
    return
  }
  if (!isValidRoundScore(points.value)) {
    errorMessage.value = t('room.score.invalidError')
    return
  }
  errorMessage.value = ''
  emit('commit', player.id, points.value)
  collapse()
}

function handlePhotoConfirm(total: number): void {
  points.value = total
  handleCommit()
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isExpanded.value) {
    collapse()
  }
}

// When the round changes (new round starts), reset the expanded state
watch(
  () => round,
  () => {
    isExpanded.value = false
    errorMessage.value = ''
  },
)
</script>

<template>
  <div
    class="bg-card border-border rounded-lg border transition-colors duration-[var(--dur)] motion-reduce:transition-none"
    :class="isExpanded ? 'ring-ring ring-2' : 'hover:bg-muted'"
    @keydown="handleKeyDown"
  >
    <!-- Collapsed: tappable header -->
    <button
      type="button"
      class="flex w-full items-center justify-between gap-3 p-4 text-left"
      :aria-expanded="isExpanded"
      :aria-label="
        isScored
          ? t('room.score.cardLabelScored', { name: player.name })
          : t('room.score.cardLabel', { name: player.name })
      "
      @click="expand"
    >
      <span class="text-foreground truncate text-base font-medium">{{ player.name }}</span>
      <span v-if="isScored" class="text-primary flex shrink-0 items-center gap-1 text-sm">
        <Check aria-hidden="true" class="size-4" />
        {{ t('room.score.scoredLabel') }}
      </span>
    </button>

    <!-- Expanded: inline score entry -->
    <div v-if="isExpanded" class="border-border flex flex-col gap-3 border-t px-4 pt-3 pb-4">
      <RoundScoreInput
        :id="inputId"
        v-model="points"
        :label="label"
        :is-invalid="hasError"
        :described-by="hasError ? errorId : undefined"
        @commit="handleCommit"
      />

      <PhotoCountSheet
        v-if="canSnapCards"
        :id="photoCountId"
        :room-code="roomCode ?? ''"
        @confirm="handlePhotoConfirm"
      />

      <p v-if="hasError" :id="errorId" role="alert" class="text-destructive text-sm">
        {{ errorMessage }}
      </p>

      <button
        type="button"
        class="text-muted-foreground hover:text-foreground h-11 text-sm"
        @click="collapse"
      >
        {{ t('room.score.cancel') }}
      </button>
    </div>
  </div>
</template>
