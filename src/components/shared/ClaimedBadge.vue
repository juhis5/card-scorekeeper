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
  <span class="text-primary inline-flex shrink-0 items-center" :title="t('account.name.badge')">
    <BadgeCheck aria-hidden="true" class="size-4" />
    <span class="sr-only">{{ t('account.name.badge') }}</span>
  </span>
</template>
