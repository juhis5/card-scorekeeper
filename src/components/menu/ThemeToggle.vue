<script setup lang="ts">
/**
 * Single job: the app menu's dark mode row (third playtest: settings as whole tappable rows). The
 * row is the switch's label, so a tap anywhere on it flips the theme; the switch itself carries the
 * on/off state to screen readers (`role="switch"`) and shows it by the thumb's position, not by
 * color alone (a11y-mobile).
 */
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { MENU_ROW_CLASS } from '@/components/menu/menu-row'
import { Switch } from '@/components/ui/switch'
import { useTheme } from '@/composables/useTheme'

const { t } = useI18n()
const { theme, setTheme } = useTheme()
const switchId = useId()

function handleChange(isDark: boolean): void {
  setTheme(isDark ? 'dark' : 'light')
}
</script>

<template>
  <label :for="switchId" :class="[MENU_ROW_CLASS, 'cursor-pointer']">
    <span>{{ t('app.theme.label') }}</span>
    <Switch :id="switchId" :model-value="theme === 'dark'" @update:model-value="handleChange" />
  </label>
</template>
