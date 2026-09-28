<script setup lang="ts">
/**
 * Single job: the ✕ beside a "Peli kesken" row on Home (fifth round), with its confirm. Deletes
 * the local game, or leaves the online room (ending it for everyone if this device is its host).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useLeaveGame } from '@/composables/useLeaveGame'

/** A room code for an online room; none for the game on this device. */
const { roomCode = null } = defineProps<{ roomCode?: string | null }>()

const emit = defineEmits<{ left: [] }>()

const { t } = useI18n()
const { leaveOnlineRoom, deleteLocalGame } = useLeaveGame()
const isOpen = ref(false)
const isBusy = ref(false)

const copy = computed(() =>
  roomCode
    ? {
        label: t('room.end.leaveRoomLabel', { code: roomCode }),
        title: t('room.end.roomTitle', { code: roomCode }),
        body: t('room.end.roomBody'),
        confirm: t('room.end.confirmLeave'),
      }
    : {
        label: t('room.end.deleteLocalLabel'),
        title: t('room.end.localTitle'),
        body: t('room.end.localBody'),
        confirm: t('room.end.confirmDelete'),
      },
)

async function confirm(): Promise<void> {
  if (isBusy.value) return
  isBusy.value = true
  try {
    if (roomCode) await leaveOnlineRoom(roomCode)
    else await deleteLocalGame()
  } finally {
    isBusy.value = false
  }
  isOpen.value = false
  emit('left')
}
</script>

<template>
  <AlertDialog v-model:open="isOpen">
    <AlertDialogTrigger as-child>
      <Button variant="outline" size="icon" class="size-11 shrink-0" :aria-label="copy.label">
        <X aria-hidden="true" class="size-4" />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent size="sm">
      <AlertDialogTitle class="text-base font-semibold">{{ copy.title }}</AlertDialogTitle>
      <AlertDialogDescription class="text-muted-foreground text-sm">
        {{ copy.body }}
      </AlertDialogDescription>
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
