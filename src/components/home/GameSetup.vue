<script setup lang="ts">
/**
 * Single job: Home's "Uusi peli" form. Starts an online room when the backend is reachable, else a
 * local game; "This phone only" skips the check. Other players are added in the room, so it asks
 * only for the name, which Home shares with "Liity".
 */
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useLocalStorage } from '@vueuse/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useGameConnectivity } from '@/composables/useGameConnectivity'
import { useGameStore } from '@/stores/game'
import { useIdentityStore } from '@/stores/identity'
import { LOCAL_GAME_ROUTE_CODE } from '@/lib/data/local-game-route'
import { hasUnfinishedPersistedGame } from '@/lib/data/local-repository'
import { cleanPlayerName } from '@/lib/game/player-names'
import type { HostGameMode } from '@/lib/data/game-mode'
import { MAX_PLAYER_NAME_LENGTH } from '@/lib/game/rules'

const name = defineModel<string>('name', { required: true })

const { t } = useI18n()
const router = useRouter()
const identity = useIdentityStore()
const game = useGameStore()
const { hostRepository, localRepository } = useGameConnectivity()

/** Remembered on this device: a table without phones tends to stay that way. */
const isThisPhoneOnly = useLocalStorage('this-phone-only', false)
const attemptedSubmit = ref(false)
const isSubmitting = ref(false)
const isCheckingConnection = ref(false)
const submitError = ref('')
/** A local game waiting for the host's OK: it would overwrite this device's unfinished one. */
const pendingReplaceMode = ref<HostGameMode | null>(null)
let hasConfirmedReplace = false
const keepPlayingButton = useTemplateRef<InstanceType<typeof Button>>('keepPlaying')

const hostName = computed(() => cleanPlayerName(name.value))
const isNameInvalid = computed(() => attemptedSubmit.value && hostName.value === '')

async function startGame(mode: HostGameMode): Promise<void> {
  identity.setDisplayName(hostName.value)
  await game.start(mode.repository, {
    hostDeviceUuid: identity.deviceUuid,
    hostDisplayName: hostName.value,
  })
  const roomCodeParam =
    mode.kind === 'online' ? (game.roomCode ?? LOCAL_GAME_ROUTE_CODE) : LOCAL_GAME_ROUTE_CODE
  await router.push({ name: 'room', params: { code: roomCodeParam } })
}

/** If creating the online room fails after the check passed, plays locally instead. */
async function startOrFallBack(mode: HostGameMode): Promise<void> {
  if (mode.kind === 'offline' && !hasConfirmedReplace && hasUnfinishedPersistedGame()) {
    pendingReplaceMode.value = mode
    await nextTick()
    const element: unknown = keepPlayingButton.value?.$el
    if (element instanceof HTMLElement) element.focus()
    return
  }
  try {
    await startGame(mode)
  } catch (error) {
    if (mode.kind !== 'online') throw error
    await startOrFallBack(localRepository())
  }
}

async function keepPlaying(): Promise<void> {
  pendingReplaceMode.value = null
  await router.push({ name: 'room', params: { code: LOCAL_GAME_ROUTE_CODE } })
}

async function replaceLocalGame(): Promise<void> {
  const mode = pendingReplaceMode.value
  if (!mode) return
  pendingReplaceMode.value = null
  hasConfirmedReplace = true
  isSubmitting.value = true
  try {
    await startOrFallBack(mode)
  } catch {
    submitError.value = t('home.errors.startFailed')
  } finally {
    isSubmitting.value = false
  }
}

async function handleSubmit(): Promise<void> {
  attemptedSubmit.value = true
  if (isNameInvalid.value || isSubmitting.value) return

  isSubmitting.value = true
  isCheckingConnection.value = !isThisPhoneOnly.value
  submitError.value = ''
  try {
    const mode = isThisPhoneOnly.value ? localRepository() : await hostRepository()
    isCheckingConnection.value = false
    await startOrFallBack(mode)
  } catch {
    submitError.value = t('home.errors.startFailed')
  } finally {
    isSubmitting.value = false
    isCheckingConnection.value = false
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="handleSubmit">
    <div class="flex flex-col gap-1.5">
      <Label for="host-name">{{ t('home.form.hostNameLabel') }}</Label>
      <Input
        id="host-name"
        v-model="name"
        :maxlength="MAX_PLAYER_NAME_LENGTH"
        type="text"
        autocomplete="name"
        enterkeyhint="go"
        class="h-11 text-base"
        :aria-invalid="isNameInvalid"
        :aria-describedby="isNameInvalid ? 'host-name-error' : undefined"
      />
      <p v-if="isNameInvalid" id="host-name-error" class="text-destructive text-sm">
        {{ t('home.errors.hostNameRequired') }}
      </p>
    </div>
    <label
      for="this-phone-only"
      class="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-medium"
    >
      {{ t('home.form.thisPhoneOnly') }}
      <Switch id="this-phone-only" v-model="isThisPhoneOnly" />
    </label>
    <p class="text-muted-foreground text-sm">
      {{ isThisPhoneOnly ? t('home.form.thisPhoneOnlyHint') : t('home.form.hint') }}
    </p>

    <p v-if="isCheckingConnection" role="status" class="text-muted-foreground text-sm">
      {{ t('home.form.checkingConnection') }}
    </p>
    <p v-if="submitError" role="alert" class="text-destructive text-sm">{{ submitError }}</p>
    <div
      v-if="pendingReplaceMode"
      role="group"
      :aria-label="t('home.form.replaceConfirm')"
      class="flex w-full flex-col gap-2"
    >
      <p class="text-foreground text-sm">{{ t('home.form.replaceConfirm') }}</p>
      <div class="flex gap-2">
        <Button
          ref="keepPlaying"
          type="button"
          variant="outline"
          class="h-11 flex-1"
          @click="keepPlaying"
        >
          {{ t('home.form.replaceKeep') }}
        </Button>
        <Button
          type="button"
          variant="outline"
          class="text-destructive border-destructive h-11 flex-1"
          @click="replaceLocalGame"
        >
          {{ t('home.form.replaceStart') }}
        </Button>
      </div>
    </div>
    <Button
      v-else
      type="submit"
      class="h-11 w-full"
      :disabled="isSubmitting"
      :aria-busy="isSubmitting"
    >
      {{ t('home.form.startButton') }}
    </Button>
  </form>
</template>
