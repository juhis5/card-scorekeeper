<script setup lang="ts">
/** Single job: an online room's code in the header, with one-tap copy and the Kutsu sheet. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy } from '@lucide/vue'
import InviteSheet from '@/components/header/InviteSheet.vue'
import { Button } from '@/components/ui/button'
import { useCopyText } from '@/composables/useCopyText'

const { code } = defineProps<{ code: string }>()

const { t } = useI18n()
const { copy, copied } = useCopyText()
const isInviteOpen = ref(false)
/** Kept in the DOM while empty, so "copied" is announced when it appears. */
const announcement = computed(() => (copied.value === code ? t('invite.codeCopied') : ''))
</script>

<template>
  <div class="flex min-w-0 flex-1 items-center justify-end gap-1">
    <span class="min-w-0 truncate text-sm font-semibold">
      {{ t('invite.room') }}
      <span class="font-mono tracking-wider">{{ code }}</span>
    </span>
    <Button
      variant="ghost"
      size="icon"
      class="size-11 shrink-0"
      :aria-label="t('invite.copyCodeLabel', { code })"
      @click="copy(code)"
    >
      <Check v-if="copied === code" aria-hidden="true" class="text-primary size-4" />
      <Copy v-else aria-hidden="true" class="size-4" />
    </Button>
    <Button variant="outline" class="h-11 shrink-0 px-3" @click="isInviteOpen = true">
      {{ t('invite.button') }}
    </Button>
    <span role="status" class="sr-only">{{ announcement }}</span>
    <InviteSheet v-model:open="isInviteOpen" :code="code" />
  </div>
</template>
