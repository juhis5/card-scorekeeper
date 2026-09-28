<script setup lang="ts">
/**
 * Single job: the "Snap cards" button and its sheet: pick a photo (no `capture`, so phones offer
 * camera or gallery), then edit the detected cards and total. `confirm` only emits the number;
 * ScoreCard commits it like typed entry, so the photo stays a suggestion.
 */
import { computed, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Camera, Loader2 } from '@lucide/vue'
import RoundScoreInput from '@/components/room/RoundScoreInput.vue'
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
import { isValidRoundScore, MAX_ROUND_SCORE, SUIT_SYMBOLS } from '@/lib/game/rules'

const { id, roomCode } = defineProps<{
  /** Base id for the form controls, unique per card. */
  id: string
  roomCode: string
}>()

const emit = defineEmits<{ confirm: [total: number] }>()

const { t, n } = useI18n()
const { isPending, countCards } = usePhotoCount()

/** The settled outcome only; `isPending` alone tracks a read in flight. */
type Status = 'idle' | 'ready' | 'error'

const isOpen = ref(false)
const status = ref<Status>('idle')
const cards = ref<PhotoCountCard[]>([])
const cardValues = ref<Array<number | null>>([])
/** Its own draft: editing a card recomputes it, but the player can also retype it directly. */
const total = ref<number | null>(null)
const failureReason = ref<PhotoCountFailureReason | null>(null)

const fileInputRef = useTemplateRef<HTMLInputElement>('fileInput')

/** Announces a successful read; the pending status and the error announce themselves. */
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

/** Failures a new photo or a later retry can fix. The rest only point at typing the total. */
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

/** The model's suit is an unchecked string, so look it up as one. */
const symbolBySuit: Readonly<Record<string, string>> = SUIT_SYMBOLS

function cardSymbol(card: PhotoCountCard): string {
  if (card.suit === null) return t('room.photoCount.jokerShort')
  return `${card.rank}${symbolBySuit[card.suit] ?? card.suit}`
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

/** Screen readers read "7♥" inconsistently and second-deck copies would share a label, so it's
 * position plus the card in words: "Card 2 of 4: 7 of hearts". */
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
  // Reset so picking the same file again still fires `change`.
  fileInputRef.value.value = ''
  fileInputRef.value.click()
}

async function handleFileChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return // picker cancelled

  const result = await countCards(roomCode, file)
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

    <Button
      type="button"
      variant="ghost"
      size="icon"
      class="size-11"
      :aria-label="t('room.photoCount.trigger')"
      @click="openSheet"
    >
      <Camera aria-hidden="true" class="size-5" />
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
