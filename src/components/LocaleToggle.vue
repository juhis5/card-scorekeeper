<script setup lang="ts">
/**
 * Single job: the app menu's language row (third playtest: settings as whole tappable rows). Only
 * two locales exist (`SUPPORTED_LOCALES` in `i18n/index.ts`), so tapping the row flips to the other
 * one through `setLocale()`, which persists the choice and sets `<html lang>` (see the i18n skill).
 * The row reads "Language · English"; its accessible name is that text plus a hint that a tap
 * switches it.
 */
import { useI18n } from 'vue-i18n'
import { Languages } from '@lucide/vue'
import { MENU_ROW_CLASS } from '@/components/menu-row'
import { setLocale, type SupportedLocale } from '@/i18n'

const { t, locale } = useI18n()

/** Only two locales exist (see `SUPPORTED_LOCALES`), so "the other one" is just the flip side. */
function otherLocale(): SupportedLocale {
  return locale.value === 'en' ? 'fi' : 'en'
}

function toggleLocale(): void {
  setLocale(otherLocale())
}
</script>

<template>
  <button type="button" :class="MENU_ROW_CLASS" @click="toggleLocale">
    <span>{{ t('app.menu.language') }}</span>
    <span class="text-muted-foreground flex items-center gap-2 text-sm">
      <Languages aria-hidden="true" class="size-4" />
      {{ t('app.locale.name') }}
      <span class="sr-only">, {{ t('app.locale.switchHint') }}</span>
    </span>
  </button>
</template>
