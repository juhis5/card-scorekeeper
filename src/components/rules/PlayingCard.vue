<script setup lang="ts">
/**
 * Single job: one card in the rules page's examples, white in both themes like a real card. The
 * symbol, not only colour, tells suits apart. Screen readers read the symbols badly, so the card
 * has a spoken name ("hertta seitsemän").
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SUIT_SYMBOLS } from '@/lib/game/rules'
import type { Card } from '@/lib/game/types'

const { card } = defineProps<{ card: Card }>()

const { t } = useI18n()

const isRed = computed(() => card.suit === 'hearts' || card.suit === 'diamonds')
const spokenName = computed(() =>
  card.rank === 'Joker'
    ? t('rules.card.joker')
    : t('rules.card.name', {
        suit: t(`rules.suit.${card.suit}`),
        rank: t(`rules.rank.${card.rank}`),
      }),
)
</script>

<template>
  <span
    role="img"
    :aria-label="spokenName"
    class="inline-flex h-13 w-10 shrink-0 flex-col items-center justify-center rounded-md border border-neutral-300 bg-white font-mono text-base leading-none font-medium"
    :class="card.rank === 'Joker' ? 'text-violet-700' : isRed ? 'text-red-700' : 'text-neutral-900'"
  >
    <template v-if="card.rank === 'Joker'">
      <span aria-hidden="true" class="text-xs tracking-tight">JOK</span>
      <span aria-hidden="true">★</span>
    </template>
    <template v-else>
      <span aria-hidden="true">{{ card.rank }}</span>
      <span aria-hidden="true">{{ SUIT_SYMBOLS[card.suit] }}</span>
    </template>
  </span>
</template>
