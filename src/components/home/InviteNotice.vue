<script setup lang="ts">
/**
 * Single job: Home's note that game invites wait for an answer, linking to the Account page. Looks
 * only on a device signed in with Google and online, so nobody else loads Firebase for it.
 */
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { Mail } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { useAccountStore } from '@/stores/account'
import { useInvitesStore } from '@/stores/invites'

const { t } = useI18n()
const account = useAccountStore()
const invites = useInvitesStore()
const { pendingCount } = storeToRefs(invites)

onMounted(() => {
  if (account.email && navigator.onLine) void invites.loadPendingCount()
})
</script>

<template>
  <section
    v-if="pendingCount > 0"
    class="bg-card border-border animate-in fade-in-0 flex items-center gap-3 rounded-lg border p-4 duration-(--dur) motion-reduce:animate-none"
  >
    <Mail aria-hidden="true" class="text-primary size-5 shrink-0" />
    <p class="flex-1 text-sm">
      {{ t('home.invites.notice', { count: pendingCount }, pendingCount) }}
    </p>
    <Button as-child variant="outline" class="h-11 shrink-0">
      <RouterLink :to="{ name: 'account' }">{{ t('home.invites.link') }}</RouterLink>
    </Button>
  </section>
</template>
