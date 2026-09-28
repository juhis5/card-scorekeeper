<script setup lang="ts" generic="T extends string">
/**
 * Single job: a two-or-more-way switch between views, as Home's Liity | Uusi peli and Tilastot's
 * Pelaajat | Pelit. Pressed buttons in a labelled group, so the chosen one is announced as such.
 */
const selected = defineModel<T>({ required: true })

const { label, options } = defineProps<{
  label: string
  options: readonly { value: T; label: string }[]
}>()
</script>

<template>
  <div
    role="group"
    :aria-label="label"
    class="bg-muted grid gap-1 rounded-lg p-1"
    :style="{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="focus-visible:ring-ring h-11 rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
      :class="
        selected === option.value
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      "
      :aria-pressed="selected === option.value"
      @click="selected = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
