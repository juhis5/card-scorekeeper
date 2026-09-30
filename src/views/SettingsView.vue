<script setup lang="ts">
/** The Settings page: this device's language and theme. */
import { useI18n } from 'vue-i18n'
import LanguageSection from '@/components/settings/LanguageSection.vue'
import ThemeSection from '@/components/settings/ThemeSection.vue'

const { t } = useI18n()
</script>

<template>
  <main class="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
    <div>
      <h1
        id="main-heading"
        tabindex="-1"
        class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        {{ t('settings.heading') }}
      </h1>
      <p class="text-muted-foreground mt-1 text-sm">{{ t('settings.lede') }}</p>
    </div>
    <LanguageSection />
    <ThemeSection />
  </main>
</template>
