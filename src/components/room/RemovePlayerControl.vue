<script setup lang="ts">
/**
 * Single job: the host's remove-player button. Removing deletes the seat's scores for good, so a
 * dialog asks first. Focus starts on ✕, the safe choice, and returns to the trigger on ✕. Emits
 * `remove` once the host confirms.
 */
import { useI18n } from 'vue-i18n'
import { Trash2, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

const { playerName } = defineProps<{ playerName: string }>()

const emit = defineEmits<{ remove: [] }>()

const { t } = useI18n()
</script>

<template>
  <AlertDialog>
    <AlertDialogTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="text-destructive size-11"
        :aria-label="t('room.remove.trigger', { name: playerName })"
      >
        <Trash2 aria-hidden="true" class="size-5" />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent size="sm">
      <AlertDialogTitle class="text-base font-semibold">
        {{ t('room.remove.title', { name: playerName }) }}
      </AlertDialogTitle>
      <AlertDialogDescription class="text-muted-foreground text-sm">
        {{ t('room.remove.description') }}
      </AlertDialogDescription>
      <div class="flex justify-end gap-2">
        <AlertDialogCancel
          size="icon"
          class="size-11"
          :aria-label="t('room.remove.keepLabel', { name: playerName })"
        >
          <X aria-hidden="true" class="size-5" />
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          size="icon"
          class="size-11"
          :aria-label="t('room.remove.confirmLabel', { name: playerName })"
          @click="emit('remove')"
        >
          <Trash2 aria-hidden="true" class="size-5" />
        </AlertDialogAction>
      </div>
    </AlertDialogContent>
  </AlertDialog>
</template>
