<script setup lang="ts">
/**
 * Single job: one playing card in the rules page's examples. White in both themes, like a real
 * card. The suit symbol, not only its colour, tells the suits apart, and the card has a spoken name
 * ("hertta seitsemän") since the symbols alone read badly.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Card } from '@/lib/types'

const { card } = defineProps<{ card: Card }>()

const { t } = useI18n()

const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' } as const

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
