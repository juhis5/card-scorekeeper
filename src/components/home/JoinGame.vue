<script setup lang="ts">
/**
 * Single job: the join form. Online only: there's no local game to join, so an unreachable backend
 * is a friendly error. With `roomCode` (an invite's /join/CODE page) it asks only for a name.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useGameConnectivity } from '@/composables/useGameConnectivity'
import { isValidRoomCode, normalizeRoomCode } from '@/lib/game/room-code'
import { useGameStore } from '@/stores/game'
import { useIdentityStore } from '@/stores/identity'
import { MAX_PLAYER_NAME_LENGTH } from '@/lib/game/rules'
import { NameTakenError } from '@/lib/game/player-names'
import { isPermanentWriteError } from '@/lib/data/write-errors'

const { roomCode } = defineProps<{
  /** A room code from an invite link: the field is hidden and this is joined. */
  roomCode?: string
}>()

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const identity = useIdentityStore()
const game = useGameStore()
const { joinRepository } = useGameConnectivity()

// A room page's "Join room ABCDE" link passes the code, so the player only adds a name.
const roomCodeInput = ref(typeof route.query.code === 'string' ? route.query.code : '')
/** Home shares the name with "Uusi peli"; unbound (the join page), it's this form's own. */
const joinerName = defineModel<string>('name', { default: '' })
if (joinerName.value === '') joinerName.value = identity.displayName
const attemptedSubmit = ref(false)
const isSubmitting = ref(false)
const isCheckingConnection = ref(false)
const submitError = ref('')

const normalizedCode = computed(() => normalizeRoomCode(roomCode ?? roomCodeInput.value))
const trimmedName = computed(() => joinerName.value.trim())
const isCodeInvalid = computed(
  () => attemptedSubmit.value && !isValidRoomCode(normalizedCode.value),
)
const isNameMissing = computed(() => attemptedSubmit.value && trimmedName.value === '')
/** The name is taken in the room: 'guest' when a host-added player has it, so the joiner asks
 * the host. */
const nameTaken = ref<'player' | 'guest' | null>(null)
const isNameInvalid = computed(() => isNameMissing.value || nameTaken.value !== null)
const nameError = computed(() => {
  if (isNameMissing.value) return t('home.errors.hostNameRequired')
  return nameTaken.value === 'guest'
    ? t('home.join.errors.nameTakenByGuest')
    : t('home.join.errors.nameTaken')
})

watch(joinerName, () => {
  nameTaken.value = null
})

async function handleSubmit(): Promise<void> {
  attemptedSubmit.value = true
  nameTaken.value = null
  if (isCodeInvalid.value || isNameMissing.value || isSubmitting.value) return

  isSubmitting.value = true
  isCheckingConnection.value = true
  submitError.value = ''
  try {
    const mode = await joinRepository(normalizedCode.value)
    isCheckingConnection.value = false

    if (mode.kind === 'unreachable') {
      submitError.value = t('home.join.errors.unreachable')
      return
    }

    identity.setDisplayName(trimmedName.value)
    await game.join(mode.repository, normalizedCode.value, {
      name: trimmedName.value,
      deviceUuid: identity.deviceUuid,
    })
    await router.push({ name: 'room', params: { code: normalizedCode.value } })
  } catch (error) {
    if (error instanceof NameTakenError) {
      nameTaken.value = error.isGuestSeat ? 'guest' : 'player'
      return
    }
    // A refused seat means a wrong or expired code; anything else (a timeout, a dropped
    // connection) means the game couldn't be reached.
    submitError.value = isPermanentWriteError(error)
      ? t('home.join.errors.joinFailed')
      : t('home.join.errors.unreachable')
  } finally {
    isSubmitting.value = false
    isCheckingConnection.value = false
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="handleSubmit">
    <div class="flex flex-col gap-1.5">
      <Label for="join-name">{{ t('home.join.nameLabel') }}</Label>
      <Input
        id="join-name"
        v-model="joinerName"
        :maxlength="MAX_PLAYER_NAME_LENGTH"
        type="text"
        autocomplete="name"
        :enterkeyhint="roomCode ? 'go' : 'next'"
        class="h-11 text-base"
        :aria-invalid="isNameInvalid"
        :aria-describedby="isNameInvalid ? 'join-name-error' : undefined"
      />
      <p v-if="isNameInvalid" id="join-name-error" class="text-destructive text-sm">
        {{ nameError }}
      </p>
    </div>

    <div v-if="!roomCode" class="flex flex-col gap-1.5">
      <Label for="join-room-code">{{ t('home.join.roomCodeLabel') }}</Label>
      <Input
        id="join-room-code"
        v-model="roomCodeInput"
        type="text"
        autocapitalize="characters"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="go"
        class="h-11 text-base uppercase"
        :placeholder="t('home.join.roomCodePlaceholder')"
        :aria-invalid="isCodeInvalid"
        :aria-describedby="isCodeInvalid ? 'join-room-code-error' : undefined"
      />
      <p v-if="isCodeInvalid" id="join-room-code-error" class="text-destructive text-sm">
        {{ t('home.join.errors.invalidCode') }}
      </p>
    </div>

    <p v-if="isCheckingConnection" role="status" class="text-muted-foreground text-sm">
      {{ t('home.form.checkingConnection') }}
    </p>
    <p v-if="submitError" role="alert" class="text-destructive text-sm">{{ submitError }}</p>
    <Button type="submit" class="h-11 w-full" :disabled="isSubmitting" :aria-busy="isSubmitting">
      {{ t('home.join.button') }}
    </Button>
  </form>
</template>
