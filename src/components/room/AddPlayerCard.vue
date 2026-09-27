<script setup lang="ts">
/**
 * Single job: the host adds a player at any round. Online that's a guest, a player without a phone
 * whose scores the host enters; in a local game every other player is one anyway. Collapsed to one
 * "Lisää pelaaja" button at the end of the card list, it opens inline like a score card: a title
 * row, then the name field with ✓ (add) and ✕ (cancel); Enter adds too. A player added mid-game
 * fills in the rounds they missed, like a late joiner.
 */
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { Check, Plus, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cleanPlayerName, NameTakenError } from '@/lib/game/player-names'
import { MAX_PLAYER_NAME_LENGTH } from '@/lib/game/rules'
import { isPermissionDenied } from '@/lib/data/write-errors'
import { useKeepInView } from '@/composables/useKeepInView'
import { useGameStore } from '@/stores/game'

const emit = defineEmits<{ added: [name: string] }>()

const { t } = useI18n()
const game = useGameStore()
const { isOnline } = storeToRefs(game)

const isOpen = ref(false)
const name = ref('')
const errorMessage = ref('')
const isAdding = ref(false)
const openButton = useTemplateRef<HTMLButtonElement>('openButton')
const cardElement = useTemplateRef<HTMLLIElement>('card')
const { reveal } = useKeepInView(cardElement)

const hasError = computed(() => errorMessage.value !== '')

async function open(): Promise<void> {
  isOpen.value = true
  await nextTick()
  // Like an open score card: placed first (on a phone: up under the header), then focused without
  // the browser's own scroll.
  reveal()
  document.getElementById('add-player-name')?.focus({ preventScroll: true })
}

/** The form unmounts, so hand focus back to the button that opened it: when focus was in the
 * form, or nowhere (iOS Safari doesn't focus a tapped button). Not when the host has moved on: the
 * new player's card appears before a slow add is confirmed, and they may be typing there. */
async function close(): Promise<void> {
  const focused = document.activeElement
  const isFocusHere = focused === document.body || (cardElement.value?.contains(focused) ?? false)
  isOpen.value = false
  name.value = ''
  errorMessage.value = ''
  await nextTick()
  if (isFocusHere) openButton.value?.focus()
}

function describeFailure(error: unknown, playerName: string): string {
  if (error instanceof NameTakenError) return t('home.join.errors.nameTaken')
  if (isPermissionDenied(error)) return t('room.saveError.closed')
  return t('room.addPlayer.failed', { name: playerName })
}

async function add(): Promise<void> {
  const playerName = cleanPlayerName(name.value)
  if (playerName === '') {
    errorMessage.value = t('room.addPlayer.nameRequired')
    return
  }
  if (isAdding.value) return
  isAdding.value = true
  errorMessage.value = ''
  try {
    await game.addGuest({ name: playerName })
  } catch (error) {
    errorMessage.value = describeFailure(error, playerName)
    return
  } finally {
    isAdding.value = false
  }
  emit('added', playerName)
  await close()
}
</script>

<template>
  <li
    ref="card"
    :data-card-open="isOpen || undefined"
    class="bg-card border-border rounded-lg border"
    @keydown.escape="close"
  >
    <button
      v-if="!isOpen"
      ref="openButton"
      type="button"
      class="text-foreground hover:bg-muted flex min-h-11 w-full items-center gap-2 rounded-lg p-4 text-left text-base font-medium"
      @click="open"
    >
      <Plus aria-hidden="true" class="size-4 shrink-0" />
      {{ t('room.addPlayer.button') }}
    </button>
    <!-- Laid out like an open score card, which holds up with the phone keyboard: no <form> (a
         form brings iOS its extra autofill bar over the page), a title row, then one row with
         the field, ✓ and ✕. -->
    <div v-else class="flex flex-col gap-2 px-4 pb-4">
      <p class="flex min-h-11 items-center gap-2 pt-4 pb-0">
        <span class="text-foreground text-base font-medium">{{ t('room.addPlayer.button') }}</span>
        <span v-if="isOnline" class="text-muted-foreground text-sm">
          {{ t('room.addPlayer.hint') }}
        </span>
      </p>
      <div class="flex gap-2">
        <Label for="add-player-name" class="sr-only">{{ t('room.addPlayer.nameLabel') }}</Label>
        <Input
          id="add-player-name"
          v-model="name"
          :maxlength="MAX_PLAYER_NAME_LENGTH"
          type="text"
          autocomplete="off"
          autocapitalize="words"
          enterkeyhint="done"
          :placeholder="t('room.addPlayer.nameLabel')"
          class="h-11 min-w-0 flex-1 text-base"
          :aria-invalid="hasError"
          :aria-describedby="hasError ? 'add-player-error' : undefined"
          @keydown.enter.prevent="add"
        />
        <Button
          type="button"
          size="icon"
          class="size-11 shrink-0"
          :disabled="isAdding"
          :aria-label="t('room.addPlayer.add')"
          @click="add"
        >
          <Check aria-hidden="true" class="size-5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          class="size-11 shrink-0"
          :aria-label="t('room.score.cancel')"
          @click="close"
        >
          <X aria-hidden="true" class="size-5" />
        </Button>
      </div>
      <p v-if="hasError" id="add-player-error" role="alert" class="text-destructive text-sm">
        {{ errorMessage }}
      </p>
    </div>
  </li>
</template>
