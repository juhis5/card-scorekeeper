<script setup lang="ts">
/**
 * Single job: claiming the player's name for their Google account, for good, after a confirm.
 * Only the app's owner can release a claim, so the confirm says so.
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import ClaimedBadge from '@/components/shared/ClaimedBadge.vue'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAccountStore } from '@/stores/account'
import { useIdentityStore } from '@/stores/identity'

defineProps<{
  /** A game is running: account changes wait until it ends. */
  locked: boolean
}>()

const { t } = useI18n()
const account = useAccountStore()
const { claimStatus, claimedName, isBusy } = storeToRefs(account)
const identity = useIdentityStore()

const isConfirmOpen = ref(false)
const name = computed(() => identity.displayName.trim())

async function confirm(): Promise<void> {
  await account.claim(name.value)
  isConfirmOpen.value = false
}
</script>

<template>
  <div v-if="claimStatus === 'claimed'" class="flex min-h-12 items-center gap-2 px-4 py-2">
    <span class="text-muted-foreground text-sm">{{ t('app.account.claim.yours') }}</span>
    <span class="min-w-0 truncate font-medium">{{ claimedName }}</span>
    <ClaimedBadge />
  </div>
  <div v-else-if="claimStatus === 'unclaimed'" class="flex flex-col gap-2 px-4 pb-3">
    <template v-if="name">
      <p class="text-muted-foreground text-sm">{{ t('app.account.claim.hint', { name }) }}</p>
      <Button
        variant="outline"
        class="h-11 self-start"
        :disabled="locked || isBusy"
        @click="isConfirmOpen = true"
      >
        {{ t('app.account.claim.action', { name }) }}
      </Button>
    </template>
    <p v-else class="text-muted-foreground text-sm">{{ t('app.account.claim.needsName') }}</p>
  </div>
  <AlertDialog v-model:open="isConfirmOpen">
    <AlertDialogContent size="sm">
      <AlertDialogTitle class="text-base font-semibold">
        {{ t('app.account.claim.confirmTitle', { name }) }}
      </AlertDialogTitle>
      <AlertDialogDescription class="text-muted-foreground text-sm">
        {{ t('app.account.claim.confirmBody', { name }) }}
      </AlertDialogDescription>
      <div class="flex justify-end gap-2">
        <AlertDialogCancel class="h-11">{{ t('app.account.claim.cancel') }}</AlertDialogCancel>
        <Button class="h-11" :disabled="isBusy" :aria-busy="isBusy" @click="confirm">
          {{ t('app.account.claim.confirm') }}
        </Button>
      </div>
    </AlertDialogContent>
  </AlertDialog>
</template>
