<script setup lang="ts">
/**
 * Single job: an accessible dark/light toggle, in the app menu (deferred from slice 3 — see
 * docs/DECISIONS.md). A real `<button>` with `aria-pressed` (not a text-changing label) so the
 * accessible name stays stable ("Dark mode") while `aria-pressed` carries the on/off state — the
 * Moon/Sun icon swap is the visible, non-color-only echo of the same state (a11y-mobile: never
 * color alone).
 */
import { useI18n } from 'vue-i18n'
import { Moon, Sun } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/composables/useTheme'

const { t } = useI18n()
const { theme, toggleTheme } = useTheme()
</script>

<template>
  <Button
    type="button"
    variant="ghost"
    size="icon"
    class="size-11"
    :aria-pressed="theme === 'dark'"
    :aria-label="t('app.theme.label')"
    @click="toggleTheme"
  >
    <Moon v-if="theme === 'dark'" aria-hidden="true" class="size-4" />
    <Sun v-else aria-hidden="true" class="size-4" />
  </Button>
</template>
