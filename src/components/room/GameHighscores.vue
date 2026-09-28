<script setup lang="ts">
/** Single job: the public game lists this finished game made, as they arrive. Nothing when none. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Medal } from '@lucide/vue'
import { useGameHighscores } from '@/composables/useGameHighscores'

const { gameId } = defineProps<{ gameId: string }>()

const { t, n } = useI18n()
const highscores = useGameHighscores(() => gameId)
const lines = computed(() =>
  highscores.value.map((highscore) => ({
    key: `${highscore.list}-${highscore.displayName}`,
    text: t('room.highscores.line', {
      name: highscore.displayName,
      list: t(`stats.highscores.lists.${highscore.list}.title`),
      rank: n(highscore.rank),
      value: n(highscore.value),
    }),
    isRecord: highscore.rank === 1,
  })),
)
</script>

<template>
  <section
    v-if="lines.length > 0"
    aria-labelledby="game-highscores-heading"
    class="bg-muted border-border animate-in fade-in-0 flex flex-col gap-2 rounded-lg border px-4 py-3 duration-(--dur) motion-reduce:animate-none"
  >
    <h2 id="game-highscores-heading" class="flex items-center gap-2 font-semibold">
      <Medal aria-hidden="true" class="text-brand size-4" />
      {{ t('room.highscores.heading') }}
    </h2>
    <ul role="list" class="flex flex-col gap-1 text-sm">
      <li v-for="line in lines" :key="line.key">
        {{ line.text }}
        <span v-if="line.isRecord" class="text-primary font-semibold">
          {{ t('room.highscores.record') }}
        </span>
      </li>
    </ul>
  </section>
</template>
