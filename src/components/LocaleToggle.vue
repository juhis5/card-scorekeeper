<script setup lang="ts">
/**
 * Single job: an accessible fi/en switcher for the app header (deferred from slice 3 — see
 * docs/DECISIONS.md). Only two locales exist (`SUPPORTED_LOCALES` in `i18n/index.ts`), so this is
 * a single button that flips to the other one and calls the existing `setLocale()` (which persists
 * the choice and sets `<html lang>` — see the i18n skill).
 *
 * The visible label and the accessible name both start with the same locale code (`EN`/`FI`,
 * interpolated into the SAME translated string) so the accessible name always contains the
 * visible text — screen-reader and voice-control users see/hear a consistent label, not a
 * mismatched one (WCAG "Label in Name").
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Languages } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { setLocale, type SupportedLocale } from '@/i18n'

const { t, locale } = useI18n()

const currentCode = computed(() => locale.value.toUpperCase())
const label = computed(() => t('app.locale.switchLabel', { code: currentCode.value }))

/** Only two locales exist (see `SUPPORTED_LOCALES`), so "the other one" is just the flip side —
 * no need to search the list. */
function otherLocale(): SupportedLocale {
  return locale.value === 'en' ? 'fi' : 'en'
}

function toggleLocale(): void {
  setLocale(otherLocale())
}
</script>

<template>
  <Button
    type="button"
    variant="ghost"
    size="sm"
    class="h-11 min-w-11 gap-1 px-2 text-sm font-semibold"
    :aria-label="label"
    @click="toggleLocale"
  >
    <Languages aria-hidden="true" class="size-4" />
    {{ currentCode }}
  </Button>
</template>
