<script setup lang="ts">
/**
 * Single job: the host's "remove this player" action, with an inline confirm step (removing a
 * seat also deletes its scores and can't be undone). Focus moves to "Keep", the safe choice, and
 * back to the trigger if the host declines. Emits `remove` only after confirmation; the parent
 * performs it.
 */
import { nextTick, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'

const { playerName } = defineProps<{ playerName: string }>()

const emit = defineEmits<{ remove: [] }>()

const { t } = useI18n()
const isConfirming = ref(false)
const triggerButton = useTemplateRef<InstanceType<typeof Button>>('trigger')
const keepButton = useTemplateRef<InstanceType<typeof Button>>('keep')

function focusButton(button: InstanceType<typeof Button> | null): void {
  const element: unknown = button?.$el
  if (element instanceof HTMLElement) element.focus()
}

async function askToConfirm(): Promise<void> {
  isConfirming.value = true
  await nextTick()
  focusButton(keepButton.value)
}

async function keepPlayer(): Promise<void> {
  isConfirming.value = false
  await nextTick()
  focusButton(triggerButton.value)
}
</script>

<template>
  <div
    v-if="isConfirming"
    role="group"
    :aria-label="t('room.remove.confirmText', { name: playerName })"
    class="flex basis-full flex-col gap-2 px-3 pb-3"
  >
    <p class="text-foreground text-sm">{{ t('room.remove.confirmText', { name: playerName }) }}</p>
    <div class="flex gap-2">
      <Button
        ref="keep"
        type="button"
        variant="outline"
        class="h-11 flex-1"
        :aria-label="t('room.remove.keepLabel', { name: playerName })"
        @click="keepPlayer"
      >
        {{ t('room.remove.keep') }}
      </Button>
      <Button
        type="button"
        variant="outline"
        class="text-destructive border-destructive h-11 flex-1"
        :aria-label="t('room.remove.confirmLabel', { name: playerName })"
        @click="emit('remove')"
      >
        {{ t('room.remove.confirm') }}
      </Button>
    </div>
  </div>
  <Button
    v-else
    ref="trigger"
    type="button"
    variant="ghost"
    size="icon"
    class="text-destructive size-11"
    :aria-label="t('room.remove.trigger', { name: playerName })"
    @click="askToConfirm"
  >
    <Trash2 aria-hidden="true" class="size-5" />
  </Button>
</template>
