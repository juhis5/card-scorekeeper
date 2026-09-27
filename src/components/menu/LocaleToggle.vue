<script setup lang="ts">
/**
 * Single job: the menu's language row. There are only two locales, so a tap flips to the other one
 * via `setLocale()`, which persists it and sets `<html lang>`. The sr-only hint follows the visible
 * text, so the spoken name still starts with what's shown.
 */
import { useI18n } from 'vue-i18n'
import { Languages } from '@lucide/vue'
import { MENU_ROW_CLASS } from '@/components/menu/menu-row'
import { setLocale, type SupportedLocale } from '@/i18n'

const { t, locale } = useI18n()

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
