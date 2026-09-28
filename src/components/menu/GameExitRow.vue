<script setup lang="ts">
/**
 * Single job: the menu's way out of the game you're in (fifth round). The host ends it for
 * everyone (on this device only: deletes it), a player just leaves it here. Both ask first, and
 * nothing about an ended game is recorded.
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { LogOut } from '@lucide/vue'
import { MENU_ROW_CLASS } from '@/components/menu/menu-row'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { TimeoutError } from '@/lib/platform/timeout'
import { useGameStore } from '@/stores/game'

const emit = defineEmits<{ done: [] }>()

const { t } = useI18n()
const router = useRouter()
const game = useGameStore()
const { isHost, isOnline } = storeToRefs(game)

const isOpen = ref(false)
const isBusy = ref(false)
/** 'queued': the end timed out but stays queued, so it lands once the phone is online again. */
const failure = ref<'failed' | 'queued' | null>(null)

const copy = computed(() => {
  if (!isHost.value) {
    return {
      row: t('room.end.leaveButton'),
      title: t('room.end.playerTitle'),
      body: t('room.end.playerBody'),
      confirm: t('room.end.confirmLeave'),
    }
  }
  return isOnline.value
    ? {
        row: t('room.end.endButton'),
        title: t('room.end.hostTitle'),
        body: t('room.end.hostBody'),
        confirm: t('room.end.confirmEnd'),
      }
    : {
        row: t('room.end.endButton'),
        title: t('room.end.localTitle'),
        body: t('room.end.localBody'),
        confirm: t('room.end.confirmDelete'),
      }
})

function openConfirm(): void {
  failure.value = null
  isOpen.value = true
}

async function confirm(): Promise<void> {
  if (isBusy.value) return
  isBusy.value = true
  try {
    if (isHost.value) await game.abandonGame()
    else game.leaveGame()
  } catch (error) {
    failure.value = error instanceof TimeoutError ? 'queued' : 'failed'
    return
  } finally {
    isBusy.value = false
  }
  isOpen.value = false
  emit('done')
  await router.push({ name: 'home' })
}
</script>

<template>
  <button type="button" :class="MENU_ROW_CLASS" @click="openConfirm">
    <span>{{ copy.row }}</span>
    <LogOut aria-hidden="true" class="text-destructive size-4" />
  </button>
  <AlertDialog v-model:open="isOpen">
    <AlertDialogContent size="sm">
      <AlertDialogTitle class="text-base font-semibold">{{ copy.title }}</AlertDialogTitle>
      <AlertDialogDescription class="text-muted-foreground text-sm">
        {{ copy.body }}
      </AlertDialogDescription>
      <p v-if="failure" role="alert" class="text-destructive text-sm">
        {{ failure === 'queued' ? t('room.end.queued') : t('room.end.failed') }}
      </p>
      <div class="flex justify-end gap-2">
        <AlertDialogCancel class="h-11">{{ t('room.end.cancel') }}</AlertDialogCancel>
        <Button
          variant="destructive"
          class="h-11"
          :disabled="isBusy"
          :aria-busy="isBusy"
          @click="confirm"
        >
          {{ copy.confirm }}
        </Button>
      </div>
    </AlertDialogContent>
  </AlertDialog>
</template>
