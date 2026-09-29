<script setup lang="ts">
/**
 * Single job: the Account page's name section: the name this device plays under, and its claim.
 * Renaming a claimed name moves the claim (after a confirm, as the old name frees up); a name
 * change that the claim can't follow isn't saved.
 */
import { computed, ref, useId } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import ClaimedBadge from '@/components/shared/ClaimedBadge.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cleanPlayerName, playerNameKey } from '@/lib/game/player-names'
import { MAX_PLAYER_NAME_LENGTH } from '@/lib/game/rules'
import { useAccountStore } from '@/stores/account'
import { useIdentityStore } from '@/stores/identity'

const { t } = useI18n()
const account = useAccountStore()
const { status, claimStatus, claimedName, isBusy, notice, lastAction } = storeToRefs(account)
const identity = useIdentityStore()
const inputId = useId()
const errorId = useId()

const draft = ref(identity.displayName)
const attemptedSave = ref(false)
const isSaved = ref(false)
const isMoveConfirmOpen = ref(false)

const cleanDraft = computed(() => cleanPlayerName(draft.value))
const isMissing = computed(() => attemptedSave.value && cleanDraft.value === '')
const isChanged = computed(() => cleanDraft.value !== identity.displayName)
/** Saving would move the claim: the new name is another name, not just another spelling. */
const movesClaim = computed(
  () =>
    claimStatus.value === 'claimed' &&
    claimedName.value !== null &&
    playerNameKey(cleanDraft.value) !== playerNameKey(claimedName.value),
)
const canClaimSavedName = computed(
  () =>
    status.value === 'signedIn' && claimStatus.value === 'unclaimed' && identity.displayName !== '',
)
/** Only claim notices: sign-in ones show in the Google section. */
const shownNotice = computed(() => (lastAction.value === 'claim' ? notice.value : null))

function edit(): void {
  isSaved.value = false
}

async function apply(): Promise<void> {
  isMoveConfirmOpen.value = false
  const name = cleanDraft.value
  if (movesClaim.value) {
    await account.claim(name)
    if (claimedName.value !== name) return
  }
  identity.setDisplayName(name)
  draft.value = name
  isSaved.value = true
}

function save(): void {
  attemptedSave.value = true
  if (cleanDraft.value === '' || !isChanged.value) return
  if (movesClaim.value) {
    isMoveConfirmOpen.value = true
    return
  }
  void apply()
}

function claimSavedName(): void {
  void account.claim(identity.displayName)
}
</script>

<template>
  <section
    aria-labelledby="account-name-heading"
    class="bg-card border-border flex flex-col gap-3 rounded-lg border p-4"
  >
    <h2 id="account-name-heading" class="text-lg font-semibold">{{ t('account.name.heading') }}</h2>

    <p v-if="claimStatus === 'claimed'" class="flex items-center gap-2">
      <span class="text-muted-foreground text-sm">{{ t('account.name.claimedFor') }}</span>
      <span class="min-w-0 truncate font-medium">{{ claimedName }}</span>
      <ClaimedBadge />
    </p>

    <form class="flex flex-col gap-1.5" novalidate @submit.prevent="save">
      <Label :for="inputId">{{ t('account.name.label') }}</Label>
      <div class="flex gap-2">
        <Input
          :id="inputId"
          v-model="draft"
          :maxlength="MAX_PLAYER_NAME_LENGTH"
          type="text"
          autocomplete="nickname"
          enterkeyhint="done"
          class="h-11 flex-1 text-base"
          :aria-invalid="isMissing"
          :aria-describedby="isMissing ? errorId : undefined"
          @input="edit"
        />
        <Button type="submit" class="h-11" :disabled="isBusy || !isChanged">
          {{ t('account.name.save') }}
        </Button>
      </div>
      <p v-if="isMissing" :id="errorId" class="text-destructive text-sm">
        {{ t('account.name.required') }}
      </p>
      <p class="text-muted-foreground text-sm">
        {{
          claimStatus === 'claimed'
            ? t('account.name.moveHint', { name: claimedName })
            : t('account.name.hint')
        }}
      </p>
    </form>

    <template v-if="canClaimSavedName">
      <p class="text-muted-foreground text-sm">
        {{ t('account.name.claimHint', { name: identity.displayName }) }}
      </p>
      <Button variant="outline" class="h-11 self-start" :disabled="isBusy" @click="claimSavedName">
        {{ t('account.name.claim', { name: identity.displayName }) }}
      </Button>
    </template>
    <p v-else-if="status === 'signedOut'" class="text-muted-foreground text-sm">
      {{ t('account.name.signInToClaim') }}
    </p>

    <p aria-live="polite" class="text-sm empty:hidden">
      <template v-if="shownNotice">{{ t(`account.notices.${shownNotice}`) }}</template>
      <template v-else-if="isSaved">{{ t('account.name.saved') }}</template>
    </p>
  </section>

  <AlertDialog v-model:open="isMoveConfirmOpen">
    <AlertDialogContent size="sm">
      <AlertDialogTitle class="text-base font-semibold">
        {{ t('account.name.moveTitle', { name: cleanDraft }) }}
      </AlertDialogTitle>
      <AlertDialogDescription class="text-muted-foreground text-sm">
        {{ t('account.name.moveBody', { old: claimedName }) }}
      </AlertDialogDescription>
      <div class="flex justify-end gap-2">
        <AlertDialogCancel class="h-11">{{ t('account.name.cancel') }}</AlertDialogCancel>
        <Button class="h-11" :disabled="isBusy" :aria-busy="isBusy" @click="apply">
          {{ t('account.name.moveConfirm') }}
        </Button>
      </div>
    </AlertDialogContent>
  </AlertDialog>
</template>
