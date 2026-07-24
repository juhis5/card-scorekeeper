<script setup lang="ts">
/**
 * The photo-count "snap your cards" affordance + confirm/edit sheet (see docs/PLAN.md "Entering
 * a round's score — two ways" and the vercel-gemini skill). Tapping "Snap cards" opens a bottom
 * sheet with the "lay cards flat, non-overlapping" hint and a "take/choose a photo" action
 * (`<input type="file" accept="image/*" capture="environment">` — camera on mobile, a plain file
 * picker on desktop, no extra code for that fallback). Picking a photo shows a "Reading your
 * cards…" state, then either the detected card list + total (editable) or a friendly error.
 *
 * Nothing here ever calls `game.setRoundScore` — `confirm` just emits the final number, and the
 * parent (`PlayerScoreRow`) feeds it through the SAME manual-entry commit path (including its
 * existing validation/error UI), so the photo can never silently set a score (see CLAUDE.md's
 * "photo card-count is a suggestion — always confirm/edit before it commits").
 *
 * Only ever mounted for an online room's own editable row (see `PlayerScoreRow`/`RoomView`) —
 * photo-count is online-only (needs the room-gated `/api/count` function).
 */
import { computed, ref, useTemplateRef, watch } from 'vue'
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
import { usePhotoCount, type PhotoCountCard } from '@/composables/usePhotoCount'

const { id, roomCode } = defineProps<{
  /** Base id for this instance's form controls — the caller (`PlayerScoreRow`) derives it from
   * the player's own id, so multiple rows on screen never collide. */
  id: string
  roomCode: string
}>()

const emit = defineEmits<{ confirm: [total: number] }>()

const { t } = useI18n()
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
/** Set only while the player is directly editing the Total field; cleared back to `null`
 * (falling back to the sum of `cardValues`) whenever any card value changes — editing a card
 * recomputes the total, editing the total directly overrides it until the next card edit. */
const totalOverride = ref<number | null>(null)

const fileInputRef = useTemplateRef<HTMLInputElement>('fileInput')

/** Polite announcement for a screen-reader user who isn't watching the screen while the photo
 * reads — the pending state (`role="status"`) and the error (`role="alert"`) already announce
 * themselves, this covers the missing third case: a successful read (see the a11y-mobile skill's
 * "live regions" — announce meaningful live changes, not just the in-between states). */
const resultAnnouncement = ref('')

const computedTotal = computed(() =>
  cardValues.value.reduce((sum: number, value) => sum + (value ?? 0), 0),
)
const total = computed<number | null>({
  get: () => totalOverride.value ?? computedTotal.value,
  set: (value) => {
    totalOverride.value = value
  },
})

watch(
  cardValues,
  () => {
    totalOverride.value = null
  },
  { deep: true },
)

const SUIT_SYMBOLS: Record<string, string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
}

function cardLabel(card: PhotoCountCard): string {
  return card.suit === null ? card.rank : `${card.rank}${SUIT_SYMBOLS[card.suit] ?? card.suit}`
}

function cardValueLabel(card: PhotoCountCard): string {
  return t('room.photoCount.cardValueLabel', { card: cardLabel(card) })
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
    status.value = 'error'
    return
  }

  cards.value = result.cards
  cardValues.value = result.cards.map((card) => card.value)
  totalOverride.value = null
  status.value = 'ready'
  resultAnnouncement.value = t('room.photoCount.resultAnnouncement', {
    count: result.cards.length,
    total: result.total,
  })
}

function handleConfirm(): void {
  emit('confirm', total.value ?? 0)
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
      capture="environment"
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
              {{ t('room.photoCount.error') }}
            </p>
            <Button type="button" variant="secondary" class="h-11" @click="openFilePicker">
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
                <span class="text-foreground">{{ cardLabel(card) }}</span>
                <RoundScoreInput
                  :id="`${id}-card-${index}`"
                  v-model="cardValues[index]"
                  :label="cardValueLabel(card)"
                  class="w-24"
                />
              </li>
            </ul>

            <RoundScoreInput
              :id="`${id}-total`"
              v-model="total"
              :label="t('room.photoCount.totalLabel')"
            />

            <Button type="button" variant="ghost" class="h-11" @click="openFilePicker">
              {{ t('room.photoCount.retake') }}
            </Button>
          </template>
        </div>

        <div aria-live="polite" class="sr-only">{{ resultAnnouncement }}</div>

        <SheetFooter>
          <Button v-if="status === 'ready'" type="button" class="h-11" @click="handleConfirm">
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
