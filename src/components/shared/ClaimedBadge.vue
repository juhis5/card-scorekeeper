<script setup lang="ts">
/**
 * Single job: the mark beside a name its owner claimed (signed in with Google). The icon is
 * hidden from screen readers; they hear the label instead.
 */
import { useI18n } from 'vue-i18n'
import { BadgeCheck } from '@lucide/vue'

const { t } = useI18n()
</script>

<template>
  <span
    class="text-primary inline-flex shrink-0 items-center"
    :title="t('app.account.claim.badge')"
  >
    <BadgeCheck aria-hidden="true" class="size-4" />
    <span class="sr-only">{{ t('app.account.claim.badge') }}</span>
  </span>
</template>
