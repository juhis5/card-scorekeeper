<script setup lang="ts">
/**
 * Single job: the header's sign that this is a game on this device only (fifth round: an icon
 * instead of the box above the scores). A tap opens the explanation; the room also says it once
 * to screen readers.
 */
import { useI18n } from 'vue-i18n'
import { WifiOff } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const { t } = useI18n()
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button variant="ghost" size="icon" class="size-11" :aria-label="t('room.offline.badge')">
        <WifiOff aria-hidden="true" class="size-5" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="text-sm">{{ t('room.offline.banner') }}</PopoverContent>
  </Popover>
</template>
