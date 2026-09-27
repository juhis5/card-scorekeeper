<script setup lang="ts">
/**
 * Single job: one labelled stat as a term/value pair. A `<dt>`/`<dd>` pair (wrapped in a `<div>`
 * for styling — valid inside a `<dl>` per the HTML spec), not a table: this is a label+value
 * shape, not tabular data (see a11y-mobile: the right semantic element for the content shape).
 */
defineProps<{ label: string; value: string }>()
</script>

<template>
  <div class="bg-card border-border flex flex-col gap-1 rounded-lg border p-3">
    <dt class="text-muted-foreground text-xs">{{ label }}</dt>
    <dd class="text-foreground text-lg font-semibold">{{ value }}</dd>
  </div>
</template>
