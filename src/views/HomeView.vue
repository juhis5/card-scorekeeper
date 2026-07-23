<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import GameSetup from '@/components/GameSetup.vue'

const { t } = useI18n()
</script>

<template>
  <main
    class="bg-background text-foreground mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 p-4"
  >
    <div class="flex flex-col items-center gap-2 pt-4 text-center">
      <h1
        id="main-heading"
        tabindex="-1"
        class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        {{ t('home.heading') }}
      </h1>
      <p class="text-muted-foreground">{{ t('home.tagline') }}</p>
    </div>
    <GameSetup />
  </main>
</template>
