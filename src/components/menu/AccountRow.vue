<script setup lang="ts">
/**
 * Single job: the menu's Google account row, to sign in or out. Signing in or out can change this
 * device's uid, which would cost the player their seat, so both wait while a game is running.
 */
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { LogIn } from '@lucide/vue'
import { MENU_ROW_CLASS } from '@/components/menu/menu-row'
import { Button } from '@/components/ui/button'
import { useAccountStore } from '@/stores/account'

const props = defineProps<{
  /** A game is running: its seat belongs to this device's current uid. */
  locked: boolean
}>()

const { t } = useI18n()
const account = useAccountStore()
const { status, email, isBusy, notice } = storeToRefs(account)

const isDisabled = computed(() => props.locked || isBusy.value)
const hint = computed(() => (props.locked ? t('app.account.locked') : null))

onMounted(() => {
  if (status.value === 'loading' || status.value === 'unavailable') void account.load()
})
</script>

<template>
  <div v-if="status === 'signedOut' || status === 'signedIn'" class="border-border border-b">
    <button
      v-if="status === 'signedOut'"
      type="button"
      :class="MENU_ROW_CLASS"
      class="disabled:opacity-60"
      :disabled="isDisabled"
      @click="account.signIn"
    >
      <span class="flex flex-col">
        {{ t('app.account.signIn') }}
        <span class="text-muted-foreground text-sm">{{ hint ?? t('app.account.signInHint') }}</span>
      </span>
      <LogIn aria-hidden="true" class="text-muted-foreground size-4" />
    </button>
    <div v-else class="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
      <span class="flex min-w-0 flex-col">
        {{ t('app.account.signedIn') }}
        <span class="text-muted-foreground truncate text-sm">{{ hint ?? email }}</span>
      </span>
      <Button
        variant="outline"
        size="sm"
        class="h-11 shrink-0"
        :disabled="isDisabled"
        @click="account.signOut"
      >
        {{ t('app.account.signOut') }}
      </Button>
    </div>
    <p aria-live="polite" class="text-muted-foreground px-4 pb-3 text-sm empty:hidden">
      <template v-if="notice">{{ t(`app.account.notices.${notice}`) }}</template>
    </p>
  </div>
</template>
