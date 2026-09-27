<script setup lang="ts">
/**
 * The rules: contracts, example melds and card values. Contracts and values come from rules.ts,
 * so this page can't drift from the scoring.
 */
import { useI18n } from 'vue-i18n'
import PlayingCard from '@/components/rules/PlayingCard.vue'
import { CONTRACTS, cardValue } from '@/lib/game/rules'
import type { Card, Suit } from '@/lib/game/types'

const { t, n } = useI18n()

function card(rank: Exclude<Card['rank'], 'Joker'>, suit: Suit): Card {
  return { rank, suit }
}
const JOKER: Card = { rank: 'Joker', suit: null }

/** Each example meld and whether it counts. */
const MELD_EXAMPLES = [
  {
    key: 'set',
    isValid: true,
    cards: [card('7', 'hearts'), card('7', 'spades'), card('7', 'hearts')],
  },
  {
    key: 'straight',
    isValid: true,
    cards: [card('4', 'clubs'), card('5', 'clubs'), card('6', 'clubs'), card('7', 'clubs')],
  },
  {
    key: 'aceLow',
    isValid: true,
    cards: [
      card('A', 'diamonds'),
      card('2', 'diamonds'),
      card('3', 'diamonds'),
      card('4', 'diamonds'),
    ],
  },
  {
    key: 'aceHigh',
    isValid: true,
    cards: [card('J', 'spades'), card('Q', 'spades'), card('K', 'spades'), card('A', 'spades')],
  },
  {
    key: 'noWrap',
    isValid: false,
    cards: [card('K', 'hearts'), card('A', 'hearts'), card('2', 'hearts'), card('3', 'hearts')],
  },
  {
    key: 'joker',
    isValid: true,
    cards: [card('9', 'hearts'), JOKER, card('J', 'hearts'), card('Q', 'hearts')],
  },
] as const

/** One row per value band; the value itself comes from the scoring function. */
const VALUE_ROWS = [
  { key: 'low', example: card('7', 'clubs') },
  { key: 'ten', example: card('10', 'clubs') },
  { key: 'face', example: card('K', 'clubs') },
  { key: 'ace', example: card('A', 'clubs') },
  { key: 'joker', example: JOKER },
] as const
</script>

<template>
  <main
    class="bg-background text-foreground mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4"
  >
    <h1
      id="main-heading"
      tabindex="-1"
      class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
    >
      {{ t('rules.heading') }}
    </h1>
    <p>{{ t('rules.intro') }}</p>

    <section aria-labelledby="rules-rounds" class="flex flex-col gap-2">
      <h2 id="rules-rounds" class="text-lg font-semibold">{{ t('rules.rounds.heading') }}</h2>
      <p class="text-muted-foreground text-sm">{{ t('rules.rounds.hint') }}</p>
      <ol role="list" class="flex flex-col gap-2">
        <li
          v-for="contract in CONTRACTS"
          :key="contract.round"
          class="bg-card border-border flex items-baseline gap-3 rounded-lg border px-3 py-2"
        >
          <span class="text-primary w-4 shrink-0 font-semibold tabular-nums">
            {{ n(contract.round) }}
          </span>
          <span>{{ t(contract.contractKey) }}</span>
        </li>
      </ol>
    </section>

    <section aria-labelledby="rules-melds" class="flex flex-col gap-3">
      <h2 id="rules-melds" class="text-lg font-semibold">{{ t('rules.melds.heading') }}</h2>
      <ul role="list" class="flex flex-col gap-3">
        <li
          v-for="example in MELD_EXAMPLES"
          :key="example.key"
          class="bg-card border-border flex flex-col gap-2 rounded-lg border p-3"
        >
          <p class="text-sm">{{ t(`rules.melds.${example.key}`) }}</p>
          <div class="flex flex-wrap items-center gap-1.5">
            <PlayingCard
              v-for="(exampleCard, index) in example.cards"
              :key="index"
              :card="exampleCard"
              :class="{ 'opacity-60': !example.isValid }"
            />
            <span
              class="ml-2 rounded-full px-2 py-0.5 text-xs font-medium"
              :class="
                example.isValid ? 'bg-muted text-primary' : 'bg-destructive/10 text-destructive'
              "
            >
              {{ example.isValid ? t('rules.melds.counts') : t('rules.melds.doesNotCount') }}
            </span>
          </div>
        </li>
      </ul>
    </section>

    <section aria-labelledby="rules-points" class="flex flex-col gap-2">
      <h2 id="rules-points" class="text-lg font-semibold">{{ t('rules.points.heading') }}</h2>
      <p class="text-muted-foreground text-sm">{{ t('rules.points.hint') }}</p>
      <table class="w-full text-sm">
        <thead class="sr-only">
          <tr>
            <th scope="col">{{ t('rules.points.card') }}</th>
            <th scope="col">{{ t('rules.points.value') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in VALUE_ROWS" :key="row.key" class="border-border border-b">
            <th scope="row" class="py-2 text-left font-normal">
              {{ t(`rules.points.${row.key}`) }}
            </th>
            <td class="py-2 text-right font-semibold tabular-nums">
              {{ t('rules.points.amount', { points: n(cardValue(row.example)) }) }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>
