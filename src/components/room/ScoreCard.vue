<script setup lang="ts">
/**
 * Single job: one player's score card. Opens inline; only ✓ or Enter saves, and a tap outside or
 * another card opening discards the draft. Emits the validated score for the parent to save. The
 * parent keys it by player + round, so a new round remounts it fresh.
 */
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, X } from '@lucide/vue'
import PhotoCountSheet from '@/components/room/PhotoCountSheet.vue'
import RoundScoreInput from '@/components/room/RoundScoreInput.vue'
import { Button } from '@/components/ui/button'
import { useKeepInView } from '@/composables/useKeepInView'
import { useSingleOpenCard } from '@/composables/useSingleOpenCard'
import { isValidRoundScore, MAX_ROUND_SCORE } from '@/lib/game/rules'
import type { ContractRoundNumber, Player } from '@/lib/game/types'

const {
  player,
  round,
  scoredPoints = null,
  showPoints = false,
  isOwnCard = false,
  isMissedRound = false,
  canUsePhotoCount = false,
  roomCode = null,
} = defineProps<{
  player: Player
  round: ContractRoundNumber
  /** This round's saved points, or null before they score. */
  scoredPoints?: number | null
  /** Players see their own number, the host also those it entered; otherwise just "scored". */
  showPoints?: boolean
  /** A non-host player's own card, titled "Enter your points" rather than by name. */
  isOwnCard?: boolean
  /** A round played before this player joined, still to be filled in. */
  isMissedRound?: boolean
  /** Online and this device's own card; photo-count is online-only. */
  canUsePhotoCount?: boolean
  roomCode?: string | null
}>()

const emit = defineEmits<{
  commit: [playerId: string, round: ContractRoundNumber, points: number]
}>()

const { t, n } = useI18n()
const points = ref<number | null>(null)
/** The last score this card saved, restored on Cancel/Escape. */
const savedPoints = ref<number | null>(null)
const errorMessage = ref('')
const isExpanded = ref(false)
const cardElement = useTemplateRef<HTMLLIElement>('card')
const headerButton = useTemplateRef<HTMLButtonElement>('header')
const { reveal } = useKeepInView(cardElement)
useSingleOpenCard({
  id: () => `score-${player.id}-${round}`,
  element: cardElement,
  isOpen: isExpanded,
  onDismiss: () => discardDraft({ restoreFocus: false }),
})

const inputId = computed(() => `score-card-${player.id}`)
const errorId = computed(() => `${inputId.value}-error`)
const isScored = computed(() => scoredPoints !== null)
const visiblePoints = computed(() => (showPoints ? scoredPoints : null))
const title = computed(() => (isOwnCard ? t('room.score.ownCardLabel') : player.name))
const label = computed(() =>
  isOwnCard
    ? t('room.score.ownInputLabel', { round })
    : t('room.score.inputLabel', { name: player.name, round }),
)
const hasError = computed(() => errorMessage.value !== '')
const photoCountId = computed(() => `photo-count-${player.id}`)
/** `canUsePhotoCount` implies a room code today, but this doesn't rely on it. */
const canSnapCards = computed(() => canUsePhotoCount && roomCode !== null)
const headerLabel = computed(() => (isOwnCard ? ownHeaderLabel() : playerHeaderLabel()))

/** The spoken name replaces the visible text, so it includes the title and points. */
function ownHeaderLabel(): string {
  if (isMissedRound) return t('room.score.ownCardLabelMissed', { round })
  if (visiblePoints.value !== null) {
    return t('room.score.ownCardLabelScored', { points: n(visiblePoints.value) })
  }
  return t('room.score.ownCardLabel')
}

function playerHeaderLabel(): string {
  const name = player.name
  if (isMissedRound) return t('room.score.cardLabelMissed', { name, round })
  if (visiblePoints.value !== null) {
    return t('room.score.cardLabelScoredPoints', { name, points: n(visiblePoints.value) })
  }
  return t(isScored.value ? 'room.score.cardLabelScored' : 'room.score.cardLabel', { name })
}

async function expand(): Promise<void> {
  if (isExpanded.value) return
  // Start from the synced score if visible (another device may have changed it), else the last
  // one this card saved.
  if (visiblePoints.value !== null) savedPoints.value = visiblePoints.value
  points.value = savedPoints.value
  isExpanded.value = true
  await nextTick()
  // Place it first (on a phone: under the header, above the keyboard), then focus without the
  // browser's own scroll, which would move it again (Chromium tucks it under the header).
  reveal()
  document.getElementById(inputId.value)?.focus({ preventScroll: true })
}

/** Collapsing unmounts the focused control, so focus goes back to the header, not <body>. */
async function collapse({ restoreFocus }: { restoreFocus: boolean }): Promise<void> {
  isExpanded.value = false
  errorMessage.value = ''
  if (!restoreFocus) return
  await nextTick()
  headerButton.value?.focus()
}

/** Validates and emits the typed score; false when there's nothing valid to save. */
function savePoints(): boolean {
  if (points.value === null) {
    // Nothing typed: a no-op, not an error.
    errorMessage.value = ''
    return false
  }
  if (!isValidRoundScore(points.value)) {
    errorMessage.value = t('room.score.invalidError', { max: n(MAX_ROUND_SCORE) })
    return false
  }
  errorMessage.value = ''
  savedPoints.value = points.value
  emit('commit', player.id, round, points.value)
  return true
}

function commitPoints({ restoreFocus }: { restoreFocus: boolean }): void {
  if (savePoints()) void collapse({ restoreFocus })
}

function discardDraft({ restoreFocus }: { restoreFocus: boolean }): void {
  points.value = savedPoints.value
  void collapse({ restoreFocus })
}

/** ✓ and Enter ask to save, so an empty field says why nothing happened. */
function handleSave(): void {
  if (points.value === null) {
    errorMessage.value = t('room.score.emptyError')
    return
  }
  commitPoints({ restoreFocus: true })
}

/** The photo total is a suggestion: it takes the same commit path and validation as typed entry.
 * Focus was in the sheet, which unmounts, so it returns to the header. */
function handlePhotoConfirm(total: number): void {
  points.value = total
  commitPoints({ restoreFocus: true })
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isExpanded.value) discardDraft({ restoreFocus: true })
}
</script>

<template>
  <li
    ref="card"
    :data-card-open="isExpanded || undefined"
    class="bg-card border-border rounded-lg border transition-colors duration-[var(--dur)] motion-reduce:transition-none"
    :class="isExpanded ? 'ring-ring ring-2' : 'hover:bg-muted'"
    @keydown="handleKeyDown"
  >
    <!-- The name row; while open it also holds the card's actions, wrapping when needed. -->
    <div class="flex flex-wrap items-center pr-1">
      <button
        ref="header"
        type="button"
        class="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 p-4 text-left"
        :aria-expanded="isExpanded"
        :aria-label="headerLabel"
        @click="expand"
      >
        <span class="flex min-w-0 items-center gap-2">
          <span class="text-foreground truncate text-base font-medium">{{ title }}</span>
          <span
            v-if="player.isGuest"
            aria-hidden="true"
            class="bg-muted text-muted-foreground shrink-0 rounded-full px-2 text-xs"
          >
            {{ t('room.guest') }}
          </span>
        </span>
        <span v-if="isMissedRound" class="text-muted-foreground shrink-0 text-sm">
          {{ t('room.score.missedRoundLabel', { round }) }}
        </span>
        <span
          v-if="isScored"
          class="text-primary animate-in zoom-in-75 fade-in-0 flex shrink-0 items-center gap-1 text-sm duration-(--dur) motion-reduce:animate-none"
        >
          <Check aria-hidden="true" class="size-4" />
          {{
            visiblePoints === null
              ? t('room.score.scoredLabel')
              : t('room.score.scoredPoints', { points: n(visiblePoints) })
          }}
        </span>
      </button>
      <template v-if="isExpanded">
        <PhotoCountSheet
          v-if="canSnapCards"
          :id="photoCountId"
          :room-code="roomCode ?? ''"
          @confirm="handlePhotoConfirm"
        />
        <!-- Seat-level actions the parent owns, e.g. the host removing a player. -->
        <slot name="actions" />
      </template>
    </div>

    <div
      v-if="isExpanded"
      class="animate-in fade-in-0 slide-in-from-top-1 flex flex-col gap-2 px-4 pb-4 duration-(--dur-fast) motion-reduce:animate-none"
    >
      <RoundScoreInput
        :id="inputId"
        v-model="points"
        :label="label"
        is-label-hidden
        :placeholder="t('room.score.placeholder')"
        :is-invalid="hasError"
        :described-by="hasError ? errorId : undefined"
        @commit="handleSave"
      >
        <Button
          type="button"
          size="icon"
          class="size-11 shrink-0"
          :aria-label="t('room.score.save')"
          @click="handleSave"
        >
          <Check aria-hidden="true" class="size-5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          class="size-11 shrink-0"
          :aria-label="t('room.score.cancel')"
          @click="discardDraft({ restoreFocus: true })"
        >
          <X aria-hidden="true" class="size-5" />
        </Button>
      </RoundScoreInput>

      <p v-if="hasError" :id="errorId" role="alert" class="text-destructive text-sm">
        {{ errorMessage }}
      </p>
    </div>
  </li>
</template>
