<script setup lang="ts">
/** The Account page: Google sign-in, game invites and the name this device plays under. */
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import GoogleAccountCard from '@/components/account/GoogleAccountCard.vue'
import InvitesSection from '@/components/account/InvitesSection.vue'
import PlayerNameCard from '@/components/account/PlayerNameCard.vue'
import { useAccountStore } from '@/stores/account'
import { useGameStore } from '@/stores/game'

const { t } = useI18n()
const account = useAccountStore()
const { status } = storeToRefs(account)
const { isRunning } = storeToRefs(useGameStore())

onMounted(() => {
  if (status.value === 'loading' || status.value === 'unavailable') void account.load()
})
</script>

<template>
  <main class="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
    <div>
      <h1
        id="main-heading"
        tabindex="-1"
        class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        {{ t('account.heading') }}
      </h1>
      <p class="text-muted-foreground mt-1 text-sm">{{ t('account.lede') }}</p>
    </div>
    <GoogleAccountCard :locked="isRunning" />
    <InvitesSection v-if="status === 'signedIn'" />
    <PlayerNameCard />
  </main>
</template>
