<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const { t } = useI18n()
</script>

<template>
  <main
    class="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-4 p-4"
  >
    <h1 class="text-2xl font-semibold">{{ t('notFound.heading') }}</h1>
    <RouterLink :to="{ name: 'home' }" class="text-primary underline underline-offset-4">
      {{ t('notFound.backHome') }}
    </RouterLink>
  </main>
</template>
