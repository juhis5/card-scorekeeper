<script setup lang="ts">
/**
 * Single job: the Settings page's theme choice, a radio per theme. Each swatch wears its theme's
 * class, so it shows that palette's own background and accent.
 */
import { useI18n } from 'vue-i18n'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useTheme } from '@/composables/useTheme'
import { isDarkTheme, paletteClass, parseTheme, THEMES, type Theme } from '@/lib/platform/themes'

const { t } = useI18n()
const { theme, setTheme } = useTheme()

function swatchClass(option: Theme): string {
  return paletteClass(option) ?? (isDarkTheme(option) ? 'dark' : 'theme-light')
}

function handleChange(value: unknown): void {
  setTheme(parseTheme(String(value)))
}
</script>

<template>
  <section
    aria-labelledby="settings-theme-heading"
    class="bg-card border-border flex flex-col gap-1 rounded-lg border py-3"
  >
    <h2 id="settings-theme-heading" class="px-4 pb-1 text-lg font-semibold">
      {{ t('app.theme.label') }}
    </h2>
    <RadioGroup
      :model-value="theme"
      :aria-label="t('app.theme.label')"
      class="gap-0"
      @update:model-value="handleChange"
    >
      <label
        v-for="option in THEMES"
        :key="option"
        :for="`theme-option-${option}`"
        class="hover:bg-muted flex h-11 cursor-pointer items-center gap-3 px-4 text-base"
      >
        <RadioGroupItem :id="`theme-option-${option}`" :value="option" />
        <span class="flex-1">{{ t(`app.theme.names.${option}`) }}</span>
        <span
          aria-hidden="true"
          class="border-border flex overflow-hidden rounded-full border"
          :class="swatchClass(option)"
        >
          <span class="bg-background size-4" />
          <span class="bg-primary size-4" />
        </span>
      </label>
    </RadioGroup>
  </section>
</template>
