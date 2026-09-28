<script setup lang="ts">
/** The privacy notice: what the app keeps, where, and what is public. */
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const SECTIONS = ['device', 'online', 'identity', 'public', 'photo', 'errors'] as const
</script>

<template>
  <main class="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
    <div>
      <h1
        id="main-heading"
        tabindex="-1"
        class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        {{ t('privacy.heading') }}
      </h1>
      <p class="text-muted-foreground mt-1 text-sm">{{ t('privacy.lede') }}</p>
    </div>

    <section
      v-for="section in SECTIONS"
      :key="section"
      :aria-labelledby="`privacy-${section}`"
      class="flex flex-col gap-1"
    >
      <h2 :id="`privacy-${section}`" class="text-lg font-semibold">
        {{ t(`privacy.sections.${section}.title`) }}
      </h2>
      <p class="text-muted-foreground text-sm">{{ t(`privacy.sections.${section}.body`) }}</p>
    </section>
  </main>
</template>
