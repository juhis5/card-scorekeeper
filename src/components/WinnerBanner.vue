<script setup lang="ts">
/** Single job: announce the winner(s) after round 5 — handles a single winner or a tie. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trophy } from '@lucide/vue'
import type { Standing } from '@/lib/types'

const { winners } = defineProps<{ winners: Standing[] }>()

const { t, locale } = useI18n()

// Locale-correct "Alice, Bob and Carol" / "Alice, Bob ja Carol" — Intl, never hand-joined
// strings (see the i18n skill).
const joinedNames = computed(() =>
  new Intl.ListFormat(locale.value, { style: 'long', type: 'conjunction' }).format(
    winners.map((standing) => standing.player.name),
  ),
)

const message = computed(() =>
  winners.length > 1
    ? t('room.winner.tie', { names: joinedNames.value })
    : t('room.winner.single', { name: joinedNames.value }),
)
</script>

<template>
  <!-- role="status" announces this on insertion, once, when the game finishes. -->
  <p
    role="status"
    class="bg-muted border-primary text-foreground flex items-center gap-2 rounded-lg border px-4 py-3 text-lg font-semibold"
  >
    <Trophy aria-hidden="true" class="text-primary size-5 shrink-0" />
    <span>{{ message }}</span>
  </p>
</template>
