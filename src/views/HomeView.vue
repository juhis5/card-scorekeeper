<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <main
    class="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-2 p-4"
  >
    <h1 class="text-2xl font-semibold">{{ t('home.heading') }}</h1>
    <p class="text-muted-foreground">{{ t('home.tagline') }}</p>
  </main>
</template>
