<script setup lang="ts">
/**
 * The home-screen "join" form: a room code + this device's display name, seating this device in
 * an existing Firestore room via `useGameConnectivity().joinRepository()` +
 * `useGameStore().join()`. Online-only — unlike hosting, there is no local fallback to join (see
 * `lib/game-mode.ts`'s `createJoinRepository` doc comment), so an unreachable backend here is a
 * friendly error, not a silent local game.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useGameConnectivity } from '@/composables/useGameConnectivity'
import { isValidRoomCode, normalizeRoomCode } from '@/lib/room-code'
import { useGameStore } from '@/stores/game'
import { useIdentityStore } from '@/stores/identity'
import { MAX_PLAYER_NAME_LENGTH } from '@/lib/rules'

const { t } = useI18n()
const router = useRouter()
const identity = useIdentityStore()
const game = useGameStore()
const { joinRepository } = useGameConnectivity()

const roomCodeInput = ref('')
const joinerName = ref(identity.displayName)
const attemptedSubmit = ref(false)
const isSubmitting = ref(false)
const isCheckingConnection = ref(false)
const submitError = ref('')

const normalizedCode = computed(() => normalizeRoomCode(roomCodeInput.value))
const trimmedName = computed(() => joinerName.value.trim())
const isCodeInvalid = computed(
  () => attemptedSubmit.value && !isValidRoomCode(normalizedCode.value),
)
const isNameInvalid = computed(() => attemptedSubmit.value && trimmedName.value === '')

async function handleSubmit(): Promise<void> {
  attemptedSubmit.value = true
  // Validate the code's shape before ever calling the backend (see the error-ux skill).
  if (isCodeInvalid.value || isNameInvalid.value || isSubmitting.value) return

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
  } catch {
    // Covers an invalid/expired code (Firestore rules reject the write) and any other join
    // failure alike — never a raw error, always a retryable, human message (see error-ux).
    submitError.value = t('home.join.errors.joinFailed')
  } finally {
    isSubmitting.value = false
    isCheckingConnection.value = false
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="handleSubmit">
    <Card>
      <CardHeader>
        <CardTitle>{{ t('home.join.heading') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <Label for="join-room-code">{{ t('home.join.roomCodeLabel') }}</Label>
          <Input
            id="join-room-code"
            v-model="roomCodeInput"
            type="text"
            autocapitalize="characters"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            enterkeyhint="next"
            class="h-11 text-base uppercase"
            :placeholder="t('home.join.roomCodePlaceholder')"
            :aria-invalid="isCodeInvalid"
            :aria-describedby="isCodeInvalid ? 'join-room-code-error' : undefined"
          />
          <p v-if="isCodeInvalid" id="join-room-code-error" class="text-destructive text-sm">
            {{ t('home.join.errors.invalidCode') }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="join-name">{{ t('home.join.nameLabel') }}</Label>
          <Input
            id="join-name"
            v-model="joinerName"
            :maxlength="MAX_PLAYER_NAME_LENGTH"
            type="text"
            autocomplete="name"
            enterkeyhint="done"
            class="h-11 text-base"
            :placeholder="t('home.form.hostNamePlaceholder')"
            :aria-invalid="isNameInvalid"
            :aria-describedby="isNameInvalid ? 'join-name-error' : undefined"
          />
          <p v-if="isNameInvalid" id="join-name-error" class="text-destructive text-sm">
            {{ t('home.errors.hostNameRequired') }}
          </p>
        </div>
      </CardContent>
      <CardFooter class="flex flex-col gap-2">
        <p v-if="isCheckingConnection" role="status" class="text-muted-foreground text-sm">
          {{ t('home.form.checkingConnection') }}
        </p>
        <p v-if="submitError" role="alert" class="text-destructive text-sm">{{ submitError }}</p>
        <Button
          type="submit"
          variant="outline"
          class="h-11 w-full"
          :disabled="isSubmitting"
          :aria-busy="isSubmitting"
        >
          {{ t('home.join.button') }}
        </Button>
      </CardFooter>
    </Card>
  </form>
</template>
