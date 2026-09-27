<script setup lang="ts">
/**
 * Single job: one player's round-score entry card. Collapsed by default (name + "scored" status);
 * tapping the header expands it inline to reveal the numeric input + photo-count affordance.
 * Presentation + local draft value only; persisting the score is the parent's job (it owns the
 * store call), this just emits the validated number on commit.
 *
 * Manual entry is the golden "never fails" path (see CLAUDE.md) — so an invalid commit must
 * never be silently dropped: it's rejected with a visible, screen-reader-tied error instead.
 *
 * Renders as an `<li>` — the parent wraps the cards in a `<ul role="list">` grid. No round
 * watcher: the parent keys each card by player + round, so a new round remounts it fresh.
 */
import { computed, nextTick, ref, useTemplateRef } from 'vue'
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
   * own editable card (see RoomView: photo-count is online-only, and each device only ever edits
   * its own seat). */
  canUsePhotoCount?: boolean
  roomCode?: string | null
}>()

const emit = defineEmits<{ commit: [playerId: string, points: number] }>()

const { t } = useI18n()
const points = ref<number | null>(null)
const errorMessage = ref('')
const isExpanded = ref(false)
const cardElement = useTemplateRef<HTMLLIElement>('card')
const headerButton = useTemplateRef<HTMLButtonElement>('header')

const inputId = computed(() => `score-card-${player.id}`)
const errorId = computed(() => `${inputId.value}-error`)
const label = computed(() => t('room.score.inputLabel', { name: player.name, round }))
const hasError = computed(() => errorMessage.value !== '')
const photoCountId = computed(() => `photo-count-${player.id}`)
/** `canUsePhotoCount` alone already implies `roomCode !== null` in practice (it's only ever true
 * online, and `isOnline` is derived from a non-null room code — see stores/game.ts), but this
 * checks both explicitly rather than assuming that invariant holds across a future refactor. */
const canSnapCards = computed(() => canUsePhotoCount && roomCode !== null)
const headerLabel = computed(() =>
  t(isScored ? 'room.score.cardLabelScored' : 'room.score.cardLabel', { name: player.name }),
)

async function expand(): Promise<void> {
  if (isExpanded.value) return
  isExpanded.value = true
  await nextTick()
  document.getElementById(inputId.value)?.focus()
}

/** Collapsing unmounts the focused control, so hand focus back to the header — otherwise it
 * drops to <body> and a keyboard or screen-reader user loses their place. */
async function collapse({ restoreFocus }: { restoreFocus: boolean }): Promise<void> {
  isExpanded.value = false
  errorMessage.value = ''
  if (!restoreFocus) return
  await nextTick()
  headerButton.value?.focus()
}

function focusIsInsideCard(): boolean {
  return cardElement.value?.contains(document.activeElement) ?? false
}

function commitPoints({ restoreFocus }: { restoreFocus: boolean }): void {
  if (points.value === null) {
    // Not yet typed anything — a no-op, not an error.
    errorMessage.value = ''
    return
  }
  if (!isValidRoundScore(points.value)) {
    errorMessage.value = t('room.score.invalidError')
    return
  }
  emit('commit', player.id, points.value)
  void collapse({ restoreFocus })
}

/** Enter keeps focus in the input, so reclaim it for the header. A blur commit means focus is
 * already moving elsewhere (Tab, tapping another card) — don't yank it back. */
function handleCommit(): void {
  commitPoints({ restoreFocus: focusIsInsideCard() })
}

/** The photo is only ever a SUGGESTION (see CLAUDE.md) — confirming feeds the number through the
 * exact same commit path manual entry uses (including its validation/error display), rather than
 * writing to the store directly. Focus sits in the (teleported) sheet here, which unmounts on
 * collapse, so a successful commit always returns focus to the header. */
function handlePhotoConfirm(total: number): void {
  points.value = total
  commitPoints({ restoreFocus: true })
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isExpanded.value) void collapse({ restoreFocus: true })
}
</script>

<template>
  <li
    ref="card"
    class="bg-card border-border rounded-lg border transition-colors duration-[var(--dur)] motion-reduce:transition-none"
    :class="isExpanded ? 'ring-ring ring-2' : 'hover:bg-muted'"
    @keydown="handleKeyDown"
  >
    <button
      ref="header"
      type="button"
      class="flex min-h-11 w-full items-center justify-between gap-3 p-4 text-left"
      :aria-expanded="isExpanded"
      :aria-label="headerLabel"
      @click="expand"
    >
      <span class="text-foreground truncate text-base font-medium">{{ player.name }}</span>
      <span v-if="isScored" class="text-primary flex shrink-0 items-center gap-1 text-sm">
        <Check aria-hidden="true" class="size-4" />
        {{ t('room.score.scoredLabel') }}
      </span>
    </button>

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
        @click="collapse({ restoreFocus: true })"
      >
        {{ t('room.score.cancel') }}
      </button>
    </div>
  </li>
</template>
