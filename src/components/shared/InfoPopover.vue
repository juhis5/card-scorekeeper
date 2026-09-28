<script setup lang="ts">
/** Single job: an ⓘ button that opens a short explanation beside a heading or a column label. */
import { Info } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const { label, text } = defineProps<{ label: string; text: string }>()
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button variant="ghost" size="icon" class="-my-2 size-11" :aria-label="label">
        <Info aria-hidden="true" class="size-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="text-sm">{{ text }}</PopoverContent>
  </Popover>
</template>
