<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { useServiceWorker } from '@/composables/useServiceWorker'

const route = useRoute()
const { t } = useI18n()

// Announces the active view's heading on every navigation — SPA route changes are otherwise
// silent to screen readers (see a11y-mobile + routing skills). Focus itself moves to the
// view's <h1> in router/index.ts; this is the redundant "hear it even if you're not tracking
// focus" channel.
const routeAnnouncement = computed(() => (route.meta.announceKey ? t(route.meta.announceKey) : ''))

// New-deploy update prompt (see the `pwa` skill + vite.config.ts's `registerType: 'prompt'`): a
// card table shouldn't lose a round to an SW-driven reload mid-game, so this only ever surfaces
// a dismissible banner — reloading is always the player's own choice.
const { needRefresh, reload, dismiss } = useServiceWorker()
// A live-region announcement is only reliable when the region already exists in the DOM before
// its content changes (screen readers watch existing regions for mutations; inserting a whole
// new role="status" node with text already inside it is not consistently announced) — same
// always-present-but-empty pattern as `routeAnnouncement` above. The visible banner below is a
// separate, purely visual element so the Reload/Dismiss buttons only enter the tab order while
// the prompt is actually showing.
const updateAnnouncement = computed(() => (needRefresh.value ? t('app.update.available') : ''))
</script>

<template>
  <!-- `env(safe-area-inset-*)` on the app frame, once, per the mobile-first golden rule. -->
  <div
    class="min-h-dvh pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
  >
    <div aria-live="polite" role="status" class="sr-only">{{ routeAnnouncement }}</div>
    <div aria-live="polite" role="status" class="sr-only">{{ updateAnnouncement }}</div>

    <div
      v-if="needRefresh"
      class="bg-muted text-foreground border-border mx-auto flex max-w-md items-center gap-2 rounded-lg border px-4 py-2 text-sm shadow-sm"
    >
      <span class="flex-1">{{ t('app.update.available') }}</span>
      <Button size="sm" class="h-11 px-4" @click="reload">{{ t('app.update.reload') }}</Button>
      <Button
        variant="ghost"
        size="icon"
        class="size-11"
        :aria-label="t('app.update.dismiss')"
        @click="dismiss"
      >
        <X aria-hidden="true" class="size-4" />
      </Button>
    </div>

    <RouterView />
  </div>
</template>
