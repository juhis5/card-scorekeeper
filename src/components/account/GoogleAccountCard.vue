<script setup lang="ts">
/**
 * Single job: the Account page's Google section, to sign in or out. Signing in or out can change
 * this device's uid, which would cost the player their seat, so both wait while a game runs.
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import GoogleSignInButton from '@/components/account/GoogleSignInButton.vue'
import { Button } from '@/components/ui/button'
import { useAccountStore } from '@/stores/account'

const { locked } = defineProps<{
  /** A game is running: its seat belongs to this device's current uid. */
  locked: boolean
}>()

const { t } = useI18n()
const account = useAccountStore()
const { status, email, isBusy, notice, lastAction } = storeToRefs(account)

const isDisabled = computed(() => locked || isBusy.value)
/** Claim notices show by the name instead. */
const shownNotice = computed(() => (lastAction.value === 'claim' ? null : notice.value))
</script>

<template>
  <section
    aria-labelledby="account-google-heading"
    class="bg-card border-border flex flex-col gap-3 rounded-lg border p-4"
  >
    <h2 id="account-google-heading" class="text-lg font-semibold">
      {{ t('account.google.heading') }}
    </h2>

    <p v-if="status === 'loading'" role="status" class="text-muted-foreground text-sm">
      {{ t('account.google.loading') }}
    </p>
    <template v-else-if="status === 'unavailable'">
      <p class="text-muted-foreground text-sm">{{ t('account.google.unavailable') }}</p>
      <Button variant="outline" class="h-11 self-start" @click="account.load">
        {{ t('account.google.retry') }}
      </Button>
    </template>
    <template v-else-if="status === 'signedOut'">
      <GoogleSignInButton :disabled="isDisabled" :busy="isBusy" @click="account.signIn" />
    </template>
    <div v-else class="flex flex-wrap items-center justify-between gap-3">
      <p class="flex min-w-0 flex-col">
        <span class="text-muted-foreground text-sm">{{ t('account.google.signedInAs') }}</span>
        <span class="truncate font-medium">{{ email }}</span>
      </p>
      <Button variant="outline" class="h-11" :disabled="isDisabled" @click="account.signOut">
        {{ t('account.google.signOut') }}
      </Button>
    </div>

    <p v-if="locked" class="text-muted-foreground text-sm">{{ t('account.google.locked') }}</p>
    <p aria-live="polite" class="text-sm empty:hidden">
      <template v-if="shownNotice">{{ t(`account.notices.${shownNotice}`) }}</template>
    </p>
    <RouterLink
      :to="{ name: 'privacy' }"
      class="text-primary focus-visible:ring-ring inline-flex min-h-11 items-center self-start rounded-sm text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
    >
      {{ t('account.google.privacyLink') }}
    </RouterLink>
  </section>
</template>
