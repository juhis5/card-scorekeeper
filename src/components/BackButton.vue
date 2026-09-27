<script setup lang="ts">
/**
 * Single job: the header's Back control. Goes to the previous screen in this tab, or Home when the
 * page was opened directly (a room link, a new tab), so Back never leaves the app. Leaving a room
 * doesn't end the game: Home offers to continue it.
 */
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ChevronLeft } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { hasInAppBack } from '@/lib/navigation'

const { t } = useI18n()
const router = useRouter()

function goBack(): void {
  // Read at tap time: the router's history state isn't reactive.
  if (hasInAppBack(router.options.history.state)) {
    router.back()
  } else {
    void router.push({ name: 'home' })
  }
}
</script>

<template>
  <Button
    type="button"
    variant="ghost"
    size="icon"
    class="size-11 shrink-0"
    :aria-label="t('nav.back')"
    @click="goBack"
  >
    <ChevronLeft aria-hidden="true" class="size-5" />
  </Button>
</template>
