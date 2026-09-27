<script setup lang="ts">
/**
 * Single job: the host enters this round's missing points, one player at a time. It floats near
 * the top: an iPhone centres on the whole screen, so a centred or bottom sheet sits behind the
 * keyboard. The field stays one element and takes focus back on each tap, keeping the keyboard up.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronRight, X } from '@lucide/vue'
import RoundScoreInput from '@/components/room/RoundScoreInput.vue'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { isValidRoundScore, MAX_ROUND_SCORE } from '@/lib/game/rules'
import type { PlayerId } from '@/lib/data/repository'
import type { ContractRoundNumber, Player } from '@/lib/game/types'

const open = defineModel<boolean>('open', { required: true })
const { players, round, save } = defineProps<{
  /** Everyone still missing a score this round, in seat order. */
  players: Player[]
  round: ContractRoundNumber
  /** Resolves false when the score didn't save. */
  save: (playerId: PlayerId, round: ContractRoundNumber, points: number) => Promise<boolean>
}>()

const { t, n } = useI18n()

const INPUT_ID = 'enter-all-scores-points'

/** Who the sheet started with, fixed while open, so progress reads "2/4" steadily. */
const queue = ref<Player[]>([])
const skipped = ref(new Set<PlayerId>())
const points = ref<number | null>(null)
const errorMessage = ref('')
const isSaving = ref(false)

const stillMissing = computed(() => new Set(players.map((player) => player.id)))
const remaining = computed(() =>
  queue.value.filter(
    (player) => stillMissing.value.has(player.id) && !skipped.value.has(player.id),
  ),
)
const current = computed(() => remaining.value[0] ?? null)
const nextUp = computed(() => remaining.value[1] ?? null)
const position = computed(() =>
  current.value ? queue.value.findIndex((player) => player.id === current.value?.id) + 1 : 0,
)
const hasError = computed(() => errorMessage.value !== '')

function refocusField(): void {
  document.getElementById(INPUT_ID)?.focus({ preventScroll: true })
}

async function focusField(): Promise<void> {
  await nextTick()
  refocusField()
}

/** On an iPhone a button tap takes focus from the field, closing the keyboard. Refocus while the
 * tap is still being handled; after the save's network wait is too late. */
function saveTapped(): void {
  refocusField()
  void saveAndMoveOn()
}

function skipTapped(): void {
  refocusField()
  skip()
}

watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    queue.value = [...players]
    skipped.value = new Set()
    points.value = null
    errorMessage.value = ''
  },
  { immediate: true },
)

/** Focus the field, not the dialog's first button, so the keyboard opens. */
function focusFieldOnOpen(event: Event): void {
  event.preventDefault()
  document.getElementById(INPUT_ID)?.focus({ preventScroll: true })
}

// Nobody left (entered here, skipped, or entered on their own phones): done.
watch(current, (player) => {
  if (open.value && player === null) open.value = false
})

function moveOn(): void {
  points.value = null
  errorMessage.value = ''
  void focusField()
}

async function saveAndMoveOn(): Promise<void> {
  const player = current.value
  if (!player || isSaving.value) return
  if (points.value === null) {
    errorMessage.value = t('room.score.emptyError')
    return
  }
  if (!isValidRoundScore(points.value)) {
    errorMessage.value = t('room.score.invalidError', { max: n(MAX_ROUND_SCORE) })
    return
  }
  isSaving.value = true
  try {
    if (!(await save(player.id, round, points.value))) {
      errorMessage.value = t('room.saveError.score', { name: player.name })
      return
    }
  } finally {
    isSaving.value = false
  }
  // The queue advances once the score shows up in `players`; just reset the field.
  moveOn()
}

function skip(): void {
  if (!current.value) return
  skipped.value = new Set([...skipped.value, current.value.id])
  moveOn()
}
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent
      side="top"
      :show-close-button="false"
      class="mx-auto max-w-md gap-3 rounded-xl p-4 data-[side=top]:inset-x-4 data-[side=top]:top-(--floating-sheet-top) data-[side=top]:border"
      @open-auto-focus="focusFieldOnOpen"
    >
      <SheetHeader class="flex-row items-center justify-between p-0">
        <SheetTitle>
          {{ t('room.enterAll.title', { position: n(position), total: n(queue.length) }) }}
        </SheetTitle>
        <SheetClose as-child>
          <Button
            variant="ghost"
            size="icon"
            class="-mr-2 size-11"
            :aria-label="t('room.enterAll.close')"
          >
            <X aria-hidden="true" class="size-4" />
          </Button>
        </SheetClose>
      </SheetHeader>
      <SheetDescription class="sr-only">{{ t('room.enterAll.description') }}</SheetDescription>

      <div
        v-if="current"
        class="bg-card border-border ring-ring flex flex-col gap-2 rounded-lg border px-4 pb-4 ring-2"
      >
        <p class="flex min-h-11 items-center gap-2 pt-4">
          <span class="text-foreground truncate text-base font-medium">{{ current.name }}</span>
          <span
            v-if="current.isGuest"
            class="bg-muted text-muted-foreground shrink-0 rounded-full px-2 text-xs"
          >
            {{ t('room.guest') }}
          </span>
        </p>
        <RoundScoreInput
          :id="INPUT_ID"
          v-model="points"
          :label="t('room.score.inputLabel', { name: current.name, round })"
          is-label-hidden
          :placeholder="t('room.score.placeholder')"
          :is-invalid="hasError"
          :described-by="hasError ? `${INPUT_ID}-error` : undefined"
          @commit="saveAndMoveOn"
        >
          <Button
            type="button"
            size="icon"
            class="size-11 shrink-0"
            :disabled="isSaving"
            :aria-label="t('room.enterAll.saveAndNext')"
            @mousedown.prevent
            @click="saveTapped"
          >
            <Check aria-hidden="true" class="size-5" />
          </Button>
        </RoundScoreInput>
        <p v-if="hasError" :id="`${INPUT_ID}-error`" role="alert" class="text-destructive text-sm">
          {{ errorMessage }}
        </p>
      </div>
      <div v-if="current" class="flex items-center justify-between gap-2">
        <p class="text-muted-foreground min-w-0 text-sm">
          {{ nextUp ? t('room.enterAll.next', { name: nextUp.name }) : '' }}
        </p>
        <Button
          type="button"
          variant="ghost"
          class="h-11 shrink-0 gap-1 px-3"
          :aria-label="t('room.enterAll.skip', { name: current.name })"
          @mousedown.prevent
          @click="skipTapped"
        >
          {{ t('room.enterAll.skipButton') }}
          <ChevronRight aria-hidden="true" class="size-4" />
        </Button>
      </div>
    </SheetContent>
  </Sheet>
</template>
