<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'

const route = useRoute()
const { t } = useI18n()

// Announces the active view's heading on every navigation — SPA route changes are otherwise
// silent to screen readers (see a11y-mobile + routing skills). Focus itself moves to the
// view's <h1> in router/index.ts; this is the redundant "hear it even if you're not tracking
// focus" channel.
const routeAnnouncement = computed(() => (route.meta.announceKey ? t(route.meta.announceKey) : ''))
</script>

<template>
  <!-- `env(safe-area-inset-*)` on the app frame, once, per the mobile-first golden rule. -->
  <div
    class="min-h-dvh pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
  >
    <div aria-live="polite" role="status" class="sr-only">{{ routeAnnouncement }}</div>
    <RouterView />
  </div>
</template>
