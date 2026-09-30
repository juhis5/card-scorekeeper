<script setup lang="ts">
/**
 * Single job: the Settings page's language choice. `setLocale()` persists it and sets
 * `<html lang>`. Each language is named in itself, so either reader finds their own.
 */
import { useI18n } from 'vue-i18n'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { isSupportedLocale, setLocale, type SupportedLocale } from '@/i18n'

/** Finnish first: most players read it. */
const LANGUAGES: readonly SupportedLocale[] = ['fi', 'en']

const { t, locale } = useI18n()

function handleChange(value: unknown): void {
  const chosen = String(value)
  if (isSupportedLocale(chosen)) setLocale(chosen)
}
</script>

<template>
  <section
    aria-labelledby="settings-language-heading"
    class="bg-card border-border flex flex-col gap-1 rounded-lg border py-3"
  >
    <h2 id="settings-language-heading" class="px-4 pb-1 text-lg font-semibold">
      {{ t('app.menu.language') }}
    </h2>
    <RadioGroup
      :model-value="locale"
      :aria-label="t('app.menu.language')"
      class="gap-0"
      @update:model-value="handleChange"
    >
      <label
        v-for="option in LANGUAGES"
        :key="option"
        :for="`language-option-${option}`"
        :lang="option"
        class="hover:bg-muted flex h-11 cursor-pointer items-center gap-3 px-4 text-base"
      >
        <RadioGroupItem :id="`language-option-${option}`" :value="option" />
        {{ t(`app.locale.names.${option}`) }}
      </label>
    </RadioGroup>
  </section>
</template>
