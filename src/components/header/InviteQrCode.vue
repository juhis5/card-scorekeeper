<script setup lang="ts">
/**
 * Single job: a QR code for `text`, as one SVG path. Dark on white in both themes, since scanners
 * struggle with inverted codes. The encoder loads lazily, to keep it out of the main bundle.
 */
import { computed, ref, watchEffect } from 'vue'
import { qrPath } from '@/lib/game/invite'

const { text, label } = defineProps<{ text: string; label: string }>()

/** Light modules around the code, which scanners need to find it. */
const QUIET_ZONE = 2

const modules = ref<boolean[][] | null>(null)
const size = computed(() => (modules.value?.length ?? 0) + QUIET_ZONE * 2)
const path = computed(() => (modules.value ? qrPath(modules.value) : ''))

watchEffect(async () => {
  const { encode } = await import('uqr')
  modules.value = encode(text, { border: 0 }).data
})
</script>

<template>
  <svg
    v-if="modules"
    role="img"
    :aria-label="label"
    :viewBox="`${-QUIET_ZONE} ${-QUIET_ZONE} ${size} ${size}`"
    shape-rendering="crispEdges"
    class="aspect-square w-44 max-w-full rounded-md"
  >
    <rect :x="-QUIET_ZONE" :y="-QUIET_ZONE" :width="size" :height="size" class="fill-white" />
    <path :d="path" class="fill-black" />
  </svg>
</template>
