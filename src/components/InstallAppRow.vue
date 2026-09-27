<script setup lang="ts">
/**
 * Single job: "Install the app" in the app menu (third playtest: installing didn't work on an
 * iPhone with Chrome). Where the browser has its own install prompt (Android Chrome, desktop
 * Chromium) the row opens it. Elsewhere it opens the steps for this device: on an iPhone every
 * browser installs through Share → Add to Home Screen, with Share in a different place per
 * browser. The menu leaves it out once the app runs installed, or where there's no way to install.
 */
import { computed, ref, useId } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Download } from '@lucide/vue'
import { MENU_ROW_CLASS } from '@/components/menu-row'
import type { InstallGuide } from '@/lib/install-guide'
import { useInstallStore } from '@/stores/install'

const GUIDE_STEPS: Record<InstallGuide, readonly string[]> = {
  'ios-safari': ['app.install.steps.iosSafariShare', 'app.install.steps.iosAdd'],
  'ios-chrome': ['app.install.steps.iosChromeShare', 'app.install.steps.iosAdd'],
  'ios-other': ['app.install.steps.iosOtherShare', 'app.install.steps.iosAdd'],
  android: ['app.install.steps.androidMenu', 'app.install.steps.androidAdd'],
}

const { t } = useI18n()
const install = useInstallStore()
const { canPrompt, guide } = storeToRefs(install)
const stepsId = useId()

const isGuideOpen = ref(false)

const steps = computed(() => (guide.value ? GUIDE_STEPS[guide.value] : []))

function handleClick(): void {
  if (canPrompt.value) {
    void install.promptInstall()
    return
  }
  isGuideOpen.value = !isGuideOpen.value
}
</script>

<template>
  <div>
    <button
      type="button"
      :class="MENU_ROW_CLASS"
      :aria-expanded="canPrompt ? undefined : isGuideOpen"
      :aria-controls="canPrompt ? undefined : stepsId"
      @click="handleClick"
    >
      <span>{{ t('app.install.label') }}</span>
      <Download v-if="canPrompt" aria-hidden="true" class="text-muted-foreground size-4" />
      <ChevronDown
        v-else
        aria-hidden="true"
        class="text-muted-foreground size-4 transition-transform duration-(--dur) motion-reduce:transition-none"
        :class="{ 'rotate-180': isGuideOpen }"
      />
    </button>
    <div v-if="!canPrompt && isGuideOpen" :id="stepsId" class="flex flex-col gap-2 px-4 pb-4">
      <ol class="text-foreground flex list-decimal flex-col gap-1 pl-5 text-sm">
        <li v-for="step in steps" :key="step">{{ t(step) }}</li>
      </ol>
      <p class="text-muted-foreground text-sm">{{ t('app.install.after') }}</p>
    </div>
  </div>
</template>
