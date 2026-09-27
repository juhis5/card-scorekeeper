<script setup lang="ts">
/**
 * Single job: the menu's "Install the app" row. Opens the browser's install prompt where there is
 * one (Android Chrome, desktop Chromium). Elsewhere it shows this device's steps: every iPhone
 * browser installs through Share → Add to Home Screen, but each puts Share somewhere else.
 */
import { computed, ref, useId } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Download } from '@lucide/vue'
import { MENU_ROW_CLASS } from '@/components/menu/menu-row'
import type { InstallGuide } from '@/lib/platform/install-guide'
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
