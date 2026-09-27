<script setup lang="ts">
/**
 * Single job: one player's round-score entry card. Collapsed by default (name + saved points, or
 * just "scored" when the number isn't this device's to see); tapping the header expands it inline
 * into two rows: the name row gains the card's icons (photo count, and the parent's remove), and
 * below it the points field with ✓ (save) and ✕ (cancel). ✓ is the way to save on a phone: the
 * iPhone number keypad has no Enter key. Enter and leaving the field still save too. The field's
 * label is for screen readers only; the name row already says whose points they are. A non-host player's own card reads "Enter
 * your points" instead of their name.
 * Presentation + local draft value only; persisting the score is the parent's job (it owns the
 * store call), this just emits the validated number on commit.
 *
 * Manual entry is the golden "never fails" path (see CLAUDE.md) — so an invalid commit must
 * never be silently dropped: it's rejected with a visible, screen-reader-tied error instead.
 *
 * Renders as an `<li>` — the parent wraps the cards in a `<ul role="list">` grid. No round
 * watcher: the parent keys each card by player + round, so a new round remounts it fresh.
 */
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, X } from '@lucide/vue'
import PhotoCountSheet from '@/components/PhotoCountSheet.vue'
import RoundScoreInput from '@/components/RoundScoreInput.vue'
import { Button } from '@/components/ui/button'
import { useKeepInView } from '@/composables/useKeepInView'
import { isValidRoundScore, MAX_ROUND_SCORE } from '@/lib/rules'
import type { ContractRoundNumber, Player } from '@/lib/types'

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
  /** This round's saved points for the player, or null when they haven't scored yet. */
  scoredPoints?: number | null
  /** Whether this device may show the number: players see their own, the host also sees the
   * ones it entered. Otherwise the card only says "scored" until the round is revealed. */
  showPoints?: boolean
  /** A non-host player's own card, labelled "Enter your points" rather than by name. */
  isOwnCard?: boolean
  /** A round played before this player joined the app, still to be filled in. */
  isMissedRound?: boolean
  /** Gates the "Snap cards" affordance — only true when this device is online AND this is its
   * own editable card (see RoomView: photo-count is online-only, and each device only ever edits
   * its own seat). */
  canUsePhotoCount?: boolean
  roomCode?: string | null
}>()

const emit = defineEmits<{
  commit: [playerId: string, round: ContractRoundNumber, points: number]
}>()

const { t, n } = useI18n()
const points = ref<number | null>(null)
/** The last score this card saved, so Cancel/Escape can restore the input to it. */
const savedPoints = ref<number | null>(null)
const errorMessage = ref('')
const isExpanded = ref(false)
/** Pressing a control inside the card (✓, ✕, the camera, the trash) blurs the input before that control's
 * click lands. The blur must not save, but iOS Safari doesn't focus a tapped button, so the blur's
 * relatedTarget can't tell us where focus is going. Remember the press instead. */
let isPressInsidePanel = false
const cardElement = useTemplateRef<HTMLLIElement>('card')
const headerButton = useTemplateRef<HTMLButtonElement>('header')
const { reveal } = useKeepInView(cardElement)

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
/** `canUsePhotoCount` alone already implies `roomCode !== null` in practice (it's only ever true
 * online, and `isOnline` is derived from a non-null room code — see stores/game.ts), but this
 * checks both explicitly rather than assuming that invariant holds across a future refactor. */
const canSnapCards = computed(() => canUsePhotoCount && roomCode !== null)
const headerLabel = computed(() => (isOwnCard ? ownHeaderLabel() : playerHeaderLabel()))

/** The spoken name replaces the visible text, so it carries the visible title and points too. */
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
  isPressInsidePanel = false
  // Start from the synced score when this device may see it (it may have changed on another
  // device), else from the last score this card saved.
  if (visiblePoints.value !== null) savedPoints.value = visiblePoints.value
  points.value = savedPoints.value
  isExpanded.value = true
  await nextTick()
  // Placed first (on a phone: up under the header, above where the keyboard will be), then focused
  // without the browser's own scroll, which would move it again (Chromium tucks it under the header).
  reveal()
  document.getElementById(inputId.value)?.focus({ preventScroll: true })
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

function isInsideCard(target: EventTarget | null): boolean {
  return target instanceof Node && (cardElement.value?.contains(target) ?? false)
}

/** Validates and emits the typed score; false when there's nothing valid to save. */
function savePoints(): boolean {
  if (points.value === null) {
    // Not yet typed anything — a no-op, not an error.
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

/** Longer than a tap takes from press to release; after it, a card left by keyboard closes. */
const TAP_SETTLE_MS = 500
let cancelPendingCollapse: (() => void) | null = null

/** Leaving the field by tapping another card blurs it on the press. Closing right then would shift
 * the list under the finger and the tap would land on whatever moved there, so close only once
 * that tap's click has landed, unless it landed back on this card. */
function collapseAfterTap(): void {
  cancelPendingCollapse?.()
  const finish = (event?: Event) => {
    cancelPendingCollapse?.()
    if (event && isInsideCard(event.target)) return
    void collapse({ restoreFocus: false })
  }
  const timer = setTimeout(finish, TAP_SETTLE_MS)
  window.addEventListener('click', finish, { once: true })
  cancelPendingCollapse = () => {
    clearTimeout(timer)
    window.removeEventListener('click', finish)
    cancelPendingCollapse = null
  }
}

onBeforeUnmount(() => cancelPendingCollapse?.())

function markPressInsideCard(): void {
  isPressInsidePanel = true
}

function clearPressInsideCard(): void {
  isPressInsidePanel = false
}

function discardDraft(): void {
  points.value = savedPoints.value
  void collapse({ restoreFocus: true })
}

/** Save and Enter ask to save, so an empty field says why nothing happened. Focus stays on the
 * removed input or button, so hand it to the header once the panel is gone. */
function handleSave(): void {
  if (points.value === null) {
    errorMessage.value = t('room.score.emptyError')
    return
  }
  commitPoints({ restoreFocus: true })
}

/** A blur saves only when focus is leaving the card (Tab out, tapping another card), and then
 * leaves focus where the user sent it. */
function handleInputBlur(event: FocusEvent): void {
  const wasPressInsidePanel = isPressInsidePanel
  isPressInsidePanel = false
  // Collapsing removes the focused input and Chromium blurs it on removal. That blur comes after
  // Enter already saved, or after Cancel/Escape discarded, so it must do nothing.
  if (!isExpanded.value) return
  if (wasPressInsidePanel || isInsideCard(event.relatedTarget)) return
  if (savePoints()) collapseAfterTap()
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
  if (event.key === 'Escape' && isExpanded.value) discardDraft()
}
</script>

<template>
  <li
    ref="card"
    :data-card-open="isExpanded || undefined"
    class="bg-card border-border rounded-lg border transition-colors duration-[var(--dur)] motion-reduce:transition-none"
    :class="isExpanded ? 'ring-ring ring-2' : 'hover:bg-muted'"
    @keydown="handleKeyDown"
    @pointerdown="markPressInsideCard"
    @click="clearPressInsideCard"
  >
    <!-- The name row. While the card is open it also holds the card's own actions (photo count,
         the parent's remove), which wrap onto a line of their own when they need one. -->
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
        <span v-if="isScored" class="text-primary flex shrink-0 items-center gap-1 text-sm">
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

    <div v-if="isExpanded" class="flex flex-col gap-2 px-4 pb-4">
      <RoundScoreInput
        :id="inputId"
        v-model="points"
        :label="label"
        is-label-hidden
        :placeholder="t('room.score.placeholder')"
        :is-invalid="hasError"
        :described-by="hasError ? errorId : undefined"
        @commit="handleSave"
        @blur="handleInputBlur"
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
          @click="discardDraft"
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
