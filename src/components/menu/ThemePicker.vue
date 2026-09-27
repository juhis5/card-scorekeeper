<script setup lang="ts">
/**
 * Single job: the menu's Teema row, opening to a radio per theme. Each swatch wears its theme's
 * class, so it shows that palette's own background and accent.
 */
import { ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown } from '@lucide/vue'
import { MENU_ROW_CLASS } from '@/components/menu/menu-row'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useTheme } from '@/composables/useTheme'
import { isDarkTheme, paletteClass, parseTheme, THEMES, type Theme } from '@/lib/platform/themes'

const { t } = useI18n()
const { theme, setTheme } = useTheme()
const listId = useId()
const isOpen = ref(false)

function swatchClass(option: Theme): string {
  return paletteClass(option) ?? (isDarkTheme(option) ? 'dark' : 'theme-light')
}

function handleChange(value: unknown): void {
  setTheme(parseTheme(String(value)))
}
</script>

<template>
  <div>
    <button
      type="button"
      :class="MENU_ROW_CLASS"
      :aria-expanded="isOpen"
      :aria-controls="listId"
      @click="isOpen = !isOpen"
    >
      <span>{{ t('app.theme.label') }}</span>
      <span class="text-muted-foreground flex items-center gap-2 text-sm">
        {{ t(`app.theme.names.${theme}`) }}
        <ChevronDown
          aria-hidden="true"
          class="size-4 transition-transform duration-(--dur) motion-reduce:transition-none"
          :class="{ 'rotate-180': isOpen }"
        />
      </span>
    </button>
    <RadioGroup
      v-if="isOpen"
      :id="listId"
      :model-value="theme"
      :aria-label="t('app.theme.label')"
      class="gap-0 pb-2"
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
  </div>
</template>
