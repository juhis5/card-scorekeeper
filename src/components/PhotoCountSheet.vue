<script setup lang="ts">
/**
 * The photo-count "snap your cards" affordance + confirm/edit sheet (see docs/PLAN.md "Entering
 * a round's score — two ways" and the vercel-gemini skill). Tapping "Snap cards" opens a bottom
 * sheet with the "lay cards flat, non-overlapping" hint and a "take/choose a photo" action
 * (`<input type="file" accept="image/*">` with no `capture`, so phones offer camera or gallery and
 * desktop gets a plain file picker). Picking a photo shows a "Reading your cards…" state, then
 * either the detected card list + total (editable) or an error that says what went wrong.
 *
 * Nothing here ever calls `game.setRoundScore` — `confirm` just emits the final number, and the
 * parent (`ScoreCard`) feeds it through the SAME manual-entry commit path (including its
 * existing validation/error UI), so the photo can never silently set a score (see CLAUDE.md's
 * "photo card-count is a suggestion — always confirm/edit before it commits").
 *
 * Only ever mounted for an online room's own editable card (see `ScoreCard`/`RoomView`) —
 * photo-count is online-only (needs the room-gated `/api/count` function).
 */
import { computed, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Camera, Loader2 } from '@lucide/vue'
import RoundScoreInput from '@/components/RoundScoreInput.vue'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  usePhotoCount,
  type PhotoCountCard,
  type PhotoCountFailureReason,
} from '@/composables/usePhotoCount'
import { isValidRoundScore, MAX_ROUND_SCORE } from '@/lib/rules'

const { id, roomCode } = defineProps<{
  /** Base id for this instance's form controls — the caller (`ScoreCard`) derives it from
   * the player's own id, so multiple cards on screen never collide. */
  id: string
  roomCode: string
}>()

const emit = defineEmits<{ confirm: [total: number] }>()

const { t, n } = useI18n()
const { isPending, countCards } = usePhotoCount()

/** The in-flight/loading state is owned entirely by `isPending` (from `usePhotoCount`) — this
 * only tracks the outcome once a request settles, so there's exactly one source of truth for
 * "is a read happening right now" (see the template: `isPending` is checked first, ahead of
 * `status`). */
type Status = 'idle' | 'ready' | 'error'

const isOpen = ref(false)
const status = ref<Status>('idle')
const cards = ref<PhotoCountCard[]>([])
const cardValues = ref<Array<number | null>>([])
/** Its own draft, not derived from `cardValues`: editing a card recomputes it, but the player can
 * also clear and retype it directly. */
const total = ref<number | null>(null)
const failureReason = ref<PhotoCountFailureReason | null>(null)

const fileInputRef = useTemplateRef<HTMLInputElement>('fileInput')

/** Polite announcement for a screen-reader user who isn't watching the screen while the photo
 * reads — the pending state (`role="status"`) and the error (`role="alert"`) already announce
 * themselves, this covers the missing third case: a successful read (see the a11y-mobile skill's
 * "live regions" — announce meaningful live changes, not just the in-between states). */
const resultAnnouncement = ref('')

const FAILURE_MESSAGE_KEYS = {
  unauthenticated: 'room.photoCount.errors.unauthenticated',
  forbidden: 'room.photoCount.errors.forbidden',
  'rate-limited': 'room.photoCount.errors.rateLimited',
  timeout: 'room.photoCount.errors.timeout',
  network: 'room.photoCount.errors.network',
  unavailable: 'room.photoCount.errors.unavailable',
  'image-processing': 'room.photoCount.errors.imageProcessing',
  'invalid-response': 'room.photoCount.errors.invalidResponse',
  'server-error': 'room.photoCount.errors.serverError',
} as const satisfies Record<PhotoCountFailureReason, string>

/** Failures where another photo, or the same one a bit later, can succeed. A closed room, a lost
 * session or a server fault won't fix itself, so those only point at typing the total. */
const RETRYABLE_REASONS: ReadonlySet<PhotoCountFailureReason> = new Set([
  'rate-limited',
  'timeout',
  'network',
  'unavailable',
  'image-processing',
  'invalid-response',
])

const errorMessage = computed(() =>
  failureReason.value ? t(FAILURE_MESSAGE_KEYS[failureReason.value]) : '',
)
const canRetry = computed(
  () => failureReason.value !== null && RETRYABLE_REASONS.has(failureReason.value),
)
const isTotalValid = computed(() => total.value !== null && isValidRoundScore(total.value))
/** An empty total just keeps confirm disabled; a typed but impossible one also says why. */
const isTotalInvalid = computed(() => total.value !== null && !isValidRoundScore(total.value))
const totalErrorId = computed(() => `${id}-total-error`)

const SUIT_SYMBOLS: Record<string, string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
}

function cardSymbol(card: PhotoCountCard): string {
  if (card.suit === null) return t('room.photoCount.jokerShort')
  return `${card.rank}${SUIT_SYMBOLS[card.suit] ?? card.suit}`
}

function rankName(rank: string): string {
  switch (rank) {
    case 'J':
      return t('room.photoCount.ranks.J')
    case 'Q':
      return t('room.photoCount.ranks.Q')
    case 'K':
      return t('room.photoCount.ranks.K')
    case 'A':
      return t('room.photoCount.ranks.A')
    default:
      return rank
  }
}

function suitName(suit: string): string {
  switch (suit) {
    case 'clubs':
      return t('room.photoCount.suits.clubs')
    case 'diamonds':
      return t('room.photoCount.suits.diamonds')
    case 'hearts':
      return t('room.photoCount.suits.hearts')
    case 'spades':
      return t('room.photoCount.suits.spades')
    default:
      return suit
  }
}

/** Screen readers read "7♥" inconsistently, and copies from a second deck would share a label,
 * so each input is named by position plus the card in words: "Card 2 of 4: 7 of hearts". */
function cardInputLabel(card: PhotoCountCard, index: number): string {
  const cardName =
    card.suit === null
      ? t('room.photoCount.joker')
      : t('room.photoCount.cardName', { rank: rankName(card.rank), suit: suitName(card.suit) })
  return t('room.photoCount.cardInputLabel', {
    index: index + 1,
    count: cards.value.length,
    card: cardName,
  })
}

function sumCardValues(): number {
  return cardValues.value.reduce((sum: number, value) => sum + (value ?? 0), 0)
}

function updateCardValue(index: number, value: number | null): void {
  cardValues.value[index] = value
  total.value = sumCardValues()
}

function openSheet(): void {
  isOpen.value = true
  status.value = 'idle'
  resultAnnouncement.value = ''
}

function openFilePicker(): void {
  if (!fileInputRef.value) return
  // Reset first so picking the exact same file twice in a row still fires `change`.
  fileInputRef.value.value = ''
  fileInputRef.value.click()
}

async function handleFileChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return // the player cancelled the native picker — stay put, sheet already open

  const result = await countCards(roomCode, file) // flips `isPending` for the duration
  if (!result.ok) {
    failureReason.value = result.reason
    status.value = 'error'
    return
  }

  cards.value = result.cards
  cardValues.value = result.cards.map((card) => card.value)
  total.value = result.total
  failureReason.value = null
  status.value = 'ready'
  resultAnnouncement.value = t(
    'room.photoCount.resultAnnouncement',
    { count: result.cards.length, total: n(result.total) },
    result.cards.length,
  )
}

function handleConfirm(): void {
  if (total.value === null || !isTotalValid.value) return
  emit('confirm', total.value)
  isOpen.value = false
}

function handleOpenChange(open: boolean): void {
  isOpen.value = open
  if (!open) status.value = 'idle'
}
</script>

<template>
  <div>
    <input
      :id="`${id}-file`"
      ref="fileInput"
      data-testid="photo-count-file"
      type="file"
      accept="image/*"
      class="sr-only"
      aria-hidden="true"
      tabindex="-1"
      @change="handleFileChange"
    />

    <Button type="button" variant="secondary" class="h-11" @click="openSheet">
      <Camera aria-hidden="true" class="size-4" />
      {{ t('room.photoCount.trigger') }}
    </Button>

    <Sheet :open="isOpen" @update:open="handleOpenChange">
      <SheetContent side="bottom" class="max-h-dvh overflow-y-auto" :show-close-button="false">
        <SheetHeader>
          <SheetTitle>{{ t('room.photoCount.title') }}</SheetTitle>
          <SheetDescription>{{ t('room.photoCount.hint') }}</SheetDescription>
        </SheetHeader>

        <div class="flex flex-col gap-4 px-4">
          <p
            v-if="isPending"
            role="status"
            class="text-muted-foreground flex items-center gap-2 text-sm"
          >
            <Loader2 aria-hidden="true" class="size-4 animate-spin motion-reduce:animate-none" />
            {{ t('room.photoCount.reading') }}
          </p>

          <Button v-else-if="status === 'idle'" type="button" class="h-11" @click="openFilePicker">
            <Camera aria-hidden="true" class="size-4" />
            {{ t('room.photoCount.takePhoto') }}
          </Button>

          <template v-else-if="status === 'error'">
            <p role="alert" class="text-destructive text-sm">
              {{ errorMessage }}
            </p>
            <Button
              v-if="canRetry"
              type="button"
              variant="secondary"
              class="h-11"
              @click="openFilePicker"
            >
              {{ t('room.photoCount.retry') }}
            </Button>
          </template>

          <template v-else-if="status === 'ready'">
            <ul class="flex flex-col gap-2">
              <li
                v-for="(card, index) in cards"
                :key="`${card.rank}-${card.suit}-${index}`"
                class="flex items-center justify-between gap-3"
              >
                <span aria-hidden="true" class="text-foreground">{{ cardSymbol(card) }}</span>
                <RoundScoreInput
                  :id="`${id}-card-${index}`"
                  :model-value="cardValues[index]"
                  :label="cardInputLabel(card, index)"
                  is-label-hidden
                  class="w-24"
                  @update:model-value="updateCardValue(index, $event)"
                />
              </li>
            </ul>

            <RoundScoreInput
              :id="`${id}-total`"
              v-model="total"
              :label="t('room.photoCount.totalLabel')"
              :is-invalid="isTotalInvalid"
              :described-by="isTotalInvalid ? totalErrorId : undefined"
            />
            <p v-if="isTotalInvalid" :id="totalErrorId" class="text-destructive text-sm">
              {{ t('room.score.invalidError', { max: n(MAX_ROUND_SCORE) }) }}
            </p>

            <Button type="button" variant="ghost" class="h-11" @click="openFilePicker">
              {{ t('room.photoCount.retake') }}
            </Button>
          </template>
        </div>

        <div aria-live="polite" class="sr-only">{{ resultAnnouncement }}</div>

        <SheetFooter>
          <Button
            v-if="status === 'ready'"
            type="button"
            class="h-11"
            :disabled="!isTotalValid"
            @click="handleConfirm"
          >
            {{ t('room.photoCount.confirm') }}
          </Button>
          <SheetClose as-child>
            <Button type="button" variant="ghost" class="h-11">
              {{ t('room.photoCount.cancel') }}
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </div>
</template>
