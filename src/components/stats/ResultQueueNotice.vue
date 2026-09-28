<script setup lang="ts">
/**
 * Single job: says which finished local games are not in the stats yet. Waiting games upload on
 * their own; games the server refused can be tried again (after a rules fix) or deleted, which
 * asks first because it can't be undone.
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { CloudUpload, Trash2, TriangleAlert, X } from '@lucide/vue'
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
import { useResultQueueStore } from '@/stores/result-queue'

const emit = defineEmits<{ uploaded: [] }>()

const { t, locale } = useI18n()
const queue = useResultQueueStore()
const { waitingCount, failedCount, isUploading } = storeToRefs(queue)

const countFormat = computed(() => new Intl.NumberFormat(locale.value))

function countText(key: string, count: number): string {
  return t(key, { count: countFormat.value.format(count) }, count)
}

async function retry(): Promise<void> {
  if ((await queue.retryFailed()) > 0) emit('uploaded')
}
</script>

<template>
  <section
    v-if="waitingCount > 0"
    class="bg-muted border-border animate-in fade-in-0 flex gap-3 rounded-lg border px-4 py-3 text-sm duration-(--dur) motion-reduce:animate-none"
  >
    <CloudUpload aria-hidden="true" class="mt-0.5 size-5 shrink-0" />
    <div>
      <p class="font-semibold">{{ countText('stats.queue.waiting', waitingCount) }}</p>
      <p role="status" class="text-muted-foreground mt-1">
        {{
          isUploading
            ? t('stats.queue.uploading')
            : countText('stats.queue.waitingBody', waitingCount)
        }}
      </p>
    </div>
  </section>

  <section
    v-if="failedCount > 0"
    class="bg-muted border-border animate-in fade-in-0 flex gap-3 rounded-lg border px-4 py-3 text-sm duration-(--dur) motion-reduce:animate-none"
  >
    <TriangleAlert aria-hidden="true" class="text-destructive mt-0.5 size-5 shrink-0" />
    <div class="flex flex-col gap-3">
      <div>
        <p class="font-semibold">{{ countText('stats.queue.failed', failedCount) }}</p>
        <p class="text-muted-foreground mt-1">
          {{ countText('stats.queue.failedBody', failedCount) }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" class="h-11" :disabled="isUploading" @click="retry">
          {{ t('stats.queue.retry') }}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger as-child>
            <Button variant="ghost" class="text-destructive h-11">
              {{ t('stats.queue.discard') }}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent size="sm">
            <AlertDialogTitle class="text-base font-semibold">
              {{ t('stats.queue.discardTitle') }}
            </AlertDialogTitle>
            <AlertDialogDescription class="text-muted-foreground text-sm">
              {{ t('stats.queue.discardDescription') }}
            </AlertDialogDescription>
            <div class="flex justify-end gap-2">
              <AlertDialogCancel
                size="icon"
                class="size-11"
                :aria-label="t('stats.queue.keepLabel')"
              >
                <X aria-hidden="true" class="size-5" />
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                size="icon"
                class="size-11"
                :aria-label="t('stats.queue.confirmDiscardLabel')"
                @click="queue.discardFailed()"
              >
                <Trash2 aria-hidden="true" class="size-5" />
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  </section>
</template>
