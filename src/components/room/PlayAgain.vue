<script setup lang="ts">
/**
 * Single job: what a finished game offers next. Local: Play again restarts with the same players.
 * Online, the host opens the next room with everyone seated (never a local game: other phones wait
 * for it), and each phone moves there once seated. "Join" covers a seat that never comes.
 */
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { useGameConnectivity } from '@/composables/useGameConnectivity'
import { NameTakenError } from '@/lib/game/player-names'
import { isPermanentWriteError } from '@/lib/data/write-errors'
import { useGameStore } from '@/stores/game'
import { useIdentityStore } from '@/stores/identity'

const { myName, otherNames } = defineProps<{
  myName: string
  /** Everyone else's, in seat order, for a local Play again. */
  otherNames: string[]
}>()

type PlayAgainError = 'startFailed' | 'unreachable' | 'joinFailed' | 'nameTaken'

const { t } = useI18n()
const router = useRouter()
const game = useGameStore()
const identity = useIdentityStore()
const { isHost, isOnline, nextRoomCode, hasSeatInNextRoom } = storeToRefs(game)
const { joinRepository, localRepository, nextRoomRepository } = useGameConnectivity()

const isBusy = ref(false)
const error = ref<PlayAgainError | null>(null)

const errorMessages = computed<Record<PlayAgainError, string>>(() => ({
  startFailed: t('room.playAgain.errors.startFailed'),
  unreachable: t('room.playAgain.errors.unreachable'),
  joinFailed: t('room.playAgain.errors.joinFailed'),
  nameTaken: t('room.playAgain.errors.nameTaken'),
}))
/** Kept in the DOM while empty, so it's announced when the host starts the next game. */
const nextGameStatus = computed(() => {
  if (!nextRoomCode.value) return ''
  return isHost.value ? t('room.playAgain.youStarted') : t('room.playAgain.hostStarted')
})

async function playLocalAgain(): Promise<void> {
  await game.playAgain(
    localRepository().repository,
    { hostDeviceUuid: identity.deviceUuid, hostDisplayName: myName },
    otherNames,
  )
}

async function startNextRoom(): Promise<void> {
  const mode = await nextRoomRepository()
  if (mode.kind === 'unreachable') {
    error.value = 'startFailed'
    return
  }
  try {
    await game.playAgain(mode.repository, {
      hostDeviceUuid: identity.deviceUuid,
      hostDisplayName: myName,
    })
  } catch {
    error.value = 'startFailed'
    return
  }
  // Replace, not push: Back from the next game shouldn't land on this finished one.
  if (game.roomCode) await router.replace({ name: 'room', params: { code: game.roomCode } })
}

function joinError(caught: unknown): PlayAgainError {
  if (caught instanceof NameTakenError) return 'nameTaken'
  return isPermanentWriteError(caught) ? 'joinFailed' : 'unreachable'
}

async function joinNextRoom(code: string): Promise<void> {
  const mode = await joinRepository(code)
  if (mode.kind === 'unreachable') {
    error.value = 'unreachable'
    return
  }
  try {
    await game.join(mode.repository, code, { name: myName, deviceUuid: identity.deviceUuid })
  } catch (caught) {
    error.value = joinError(caught)
    return
  }
  await router.replace({ name: 'room', params: { code } })
}

async function run(action: () => Promise<void>): Promise<void> {
  if (isBusy.value) return
  isBusy.value = true
  error.value = null
  try {
    await action()
  } finally {
    isBusy.value = false
  }
}

function handlePlayAgain(): Promise<void> {
  return run(isOnline.value ? startNextRoom : playLocalAgain)
}

function handleJoinNext(code: string): Promise<void> {
  return run(() => joinNextRoom(code))
}

// Already seated in the next room: move this phone there. On the host's phone this fires while
// Play again is still busy, so `run` skips it.
watch(
  hasSeatInNextRoom,
  (isSeated) => {
    if (isSeated && nextRoomCode.value) void handleJoinNext(nextRoomCode.value)
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex flex-col gap-2">
    <p role="status" class="text-foreground text-sm">{{ nextGameStatus }}</p>
    <Button
      v-if="nextRoomCode"
      class="h-11 w-full"
      :disabled="isBusy"
      :aria-busy="isBusy"
      @click="handleJoinNext(nextRoomCode)"
    >
      {{ isHost ? t('room.playAgain.goToNext') : t('room.playAgain.join') }}
    </Button>
    <Button
      v-else-if="isHost"
      class="h-11 w-full"
      :disabled="isBusy"
      :aria-busy="isBusy"
      @click="handlePlayAgain"
    >
      {{ t('room.playAgain.button') }}
    </Button>
    <p v-if="error" role="alert" class="text-destructive text-sm">{{ errorMessages[error] }}</p>
    <RouterLink
      v-if="error === 'nameTaken' && nextRoomCode"
      :to="{ name: 'join', params: { code: nextRoomCode } }"
      class="text-primary flex h-11 items-center underline underline-offset-4"
    >
      {{ t('room.playAgain.joinWithAnotherName') }}
    </RouterLink>
  </div>
</template>
