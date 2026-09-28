<script setup lang="ts">
/** Single job: the ⓘ beside "V–H–T" that spells out wins, losses and ties (fifth round). */
import { useI18n } from 'vue-i18n'
import { Info } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const { t } = useI18n()
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        class="-my-2 size-11"
        :aria-label="t('stats.headToHead.legendLabel')"
      >
        <Info aria-hidden="true" class="size-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="text-sm">{{ t('stats.headToHead.legend') }}</PopoverContent>
  </Popover>
</template>
