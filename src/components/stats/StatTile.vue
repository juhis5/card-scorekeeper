<script setup lang="ts">
/** Single job: one labelled stat as a `<dt>`/`<dd>` pair (a label and a value, not table data). */
defineProps<{ label: string; value: string }>()
</script>

<template>
  <div class="bg-card border-border flex flex-col gap-1 rounded-lg border p-3">
    <dt class="text-muted-foreground text-xs">{{ label }}</dt>
    <dd class="text-foreground text-lg font-semibold">{{ value }}</dd>
  </div>
</template>
