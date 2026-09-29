<script setup lang="ts">
/**
 * Single job: the Account page's open game invites, live, to accept or decline one by one or all
 * at once. A game that ended without a result can only be removed.
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { useInvitesStore, type InviteView } from '@/stores/invites'

const { t, locale } = useI18n()
const invitesStore = useInvitesStore()
const { status, invites, busyInviteId, notice } = storeToRefs(invitesStore)

/** Pending invites whose game can still count: what "Accept all" answers. */
const acceptable = computed(() =>
  invites.value.filter((invite) => invite.status === 'pending' && invite.game !== 'ended'),
)
const isBusy = computed(() => busyInviteId.value !== null)
const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'numeric', year: 'numeric' }),
)

function gameLine(invite: InviteView): string | null {
  if (invite.game === 'ended') return t('account.invites.game.ended')
  if (invite.status === 'accepted') return t('account.invites.acceptedWaiting')
  return invite.game ? t(`account.invites.game.${invite.game}`) : null
}

onMounted(() => void invitesStore.start())
onUnmounted(() => invitesStore.stop())
</script>

<template>
  <section
    aria-labelledby="account-invites-heading"
    class="bg-card border-border flex flex-col gap-3 rounded-lg border p-4"
  >
    <h2 id="account-invites-heading" class="text-lg font-semibold">
      {{ t('account.invites.heading') }}
    </h2>
    <p class="text-muted-foreground text-sm">{{ t('account.invites.lede') }}</p>

    <p v-if="status === 'loading' || status === 'idle'" role="status" class="text-sm">
      {{ t('account.invites.loading') }}
    </p>
    <p v-else-if="status === 'error'" class="text-sm">{{ t('account.invites.error') }}</p>
    <p v-else-if="invites.length === 0" class="text-muted-foreground text-sm">
      {{ t('account.invites.empty') }}
    </p>
    <template v-else>
      <Button
        v-if="acceptable.length > 1"
        class="h-11 self-start"
        :disabled="isBusy"
        @click="invitesStore.acceptAll"
      >
        {{ t('account.invites.acceptAll', { count: acceptable.length }) }}
      </Button>
      <ul role="list" class="flex flex-col gap-2">
        <li
          v-for="invite in invites"
          :key="invite.id"
          class="border-border flex flex-col gap-2 rounded-md border p-3"
        >
          <p class="flex flex-col">
            <span class="font-medium">
              {{ t('account.invites.from', { host: invite.hostName, name: invite.name }) }}
            </span>
            <span v-if="invite.createdAt" class="text-muted-foreground text-xs">
              {{ dateFormat.format(new Date(invite.createdAt)) }}
            </span>
            <span v-if="gameLine(invite)" class="text-muted-foreground text-sm">
              {{ gameLine(invite) }}
            </span>
          </p>
          <div class="flex flex-wrap gap-2">
            <template v-if="invite.game === 'ended'">
              <Button
                variant="outline"
                class="h-11"
                :disabled="isBusy"
                @click="invitesStore.decline(invite)"
              >
                {{ t('account.invites.dismiss') }}
              </Button>
            </template>
            <template v-else-if="invite.status === 'accepted'">
              <Button
                variant="outline"
                class="h-11"
                :disabled="isBusy"
                @click="invitesStore.decline(invite)"
              >
                {{ t('account.invites.cancel') }}
              </Button>
            </template>
            <template v-else>
              <Button
                class="h-11"
                :disabled="isBusy"
                :aria-busy="busyInviteId === invite.id"
                @click="invitesStore.accept(invite)"
              >
                {{ t('account.invites.accept') }}
              </Button>
              <Button
                variant="outline"
                class="h-11"
                :disabled="isBusy"
                @click="invitesStore.decline(invite)"
              >
                {{ t('account.invites.decline') }}
              </Button>
            </template>
          </div>
        </li>
      </ul>
    </template>

    <p aria-live="polite" class="text-sm empty:hidden">
      <template v-if="notice">{{ t(`account.invites.notices.${notice}`) }}</template>
    </p>
  </section>
</template>
