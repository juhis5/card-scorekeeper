<script setup lang="ts">
/** Single job: show the winner, or the tied winners, after round 5. The room's persistent live
 * region announces it: one inserted with its text already in it is often not read. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trophy } from '@lucide/vue'
import { winnerMessage } from '@/components/room/winner-message'
import type { Standing } from '@/lib/game/types'

const { winners } = defineProps<{ winners: Standing[] }>()

const i18n = useI18n()
const message = computed(() => winnerMessage(i18n, winners))
</script>

<template>
  <p
    class="bg-muted border-primary text-foreground flex items-center gap-2 rounded-lg border px-4 py-3 text-lg font-semibold"
  >
    <Trophy aria-hidden="true" class="text-primary size-5 shrink-0" />
    <span>{{ message }}</span>
  </p>
</template>
