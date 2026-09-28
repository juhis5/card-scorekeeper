<script setup lang="ts">
/** The global highscores, across every game played with the app. */
import { useI18n } from 'vue-i18n'
import HighscoresSection from '@/components/stats/HighscoresSection.vue'

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
        {{ t('stats.highscores.heading') }}
      </h1>
      <p class="text-muted-foreground mt-1 text-sm">{{ t('stats.highscores.lede') }}</p>
    </div>

    <HighscoresSection />
  </main>
</template>
