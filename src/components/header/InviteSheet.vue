<script setup lang="ts">
/**
 * Single job: the invite sheet the header's Kutsu opens. A QR code of the join link for people at
 * the same table, the code itself to read out, Kopioi koodi, and Jaa linkki: the phone's share
 * sheet, or copying the link where there is none (desktop Firefox). The link is built from the
 * current address, so on a preview or test-rommi it points there.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useShare } from '@vueuse/core'
import { Copy, Share2, X } from '@lucide/vue'
import InviteQrCode from '@/components/header/InviteQrCode.vue'
import { Button } from '@/components/ui/button'
import { useCopyText } from '@/composables/useCopyText'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { joinUrl } from '@/lib/game/invite'

const open = defineModel<boolean>('open', { required: true })
const { code } = defineProps<{ code: string }>()

const { t } = useI18n()
const { copy, copied } = useCopyText()
const { share, isSupported: canShare } = useShare()

const link = computed(() => joinUrl(window.location.origin, code))
const feedback = computed(() => {
  if (copied.value === null) return ''
  return copied.value === code ? t('invite.codeCopied') : t('invite.linkCopied')
})

async function shareLink(): Promise<void> {
  if (!canShare.value) return copy(link.value)
  try {
    await share({ title: t('app.title'), text: t('invite.shareText', { code }), url: link.value })
  } catch (error) {
    // Closing the share sheet rejects with AbortError: the player changed their mind. Any other
    // refusal (no permission) falls back to copying the link.
    if (error instanceof DOMException && error.name === 'AbortError') return
    await copy(link.value)
  }
}
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent
      side="bottom"
      :show-close-button="false"
      class="mx-auto max-w-md gap-4 rounded-t-xl p-4"
    >
      <SheetHeader class="flex-row items-center justify-between p-0">
        <SheetTitle>{{ t('invite.title') }}</SheetTitle>
        <SheetClose as-child>
          <Button variant="ghost" size="icon" class="-mr-2 size-11" :aria-label="t('invite.close')">
            <X aria-hidden="true" class="size-4" />
          </Button>
        </SheetClose>
      </SheetHeader>
      <SheetDescription>{{ t('invite.description') }}</SheetDescription>
      <div class="flex flex-col items-center gap-2">
        <InviteQrCode :text="link" :label="t('invite.qrLabel')" />
        <p class="text-muted-foreground text-sm">{{ t('invite.scan') }}</p>
        <p class="font-mono text-3xl tracking-widest select-all">{{ code }}</p>
      </div>
      <Button variant="outline" class="h-11" @click="copy(code)">
        <Copy aria-hidden="true" class="size-4" />
        {{ t('invite.copyCode') }}
      </Button>
      <Button class="h-11" @click="shareLink">
        <Share2 aria-hidden="true" class="size-4" />
        {{ t('invite.shareLink') }}
      </Button>
      <p role="status" class="min-h-5 text-center text-sm">{{ feedback }}</p>
    </SheetContent>
  </Sheet>
</template>
