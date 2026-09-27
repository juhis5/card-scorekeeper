<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import GameSetup from '@/components/GameSetup.vue'
import JoinGame from '@/components/JoinGame.vue'
import { Button } from '@/components/ui/button'
import { lastRoom } from '@/lib/last-room'
import { LOCAL_GAME_ROUTE_CODE } from '@/lib/local-game-route'
import { hasUnfinishedPersistedGame } from '@/lib/local-repository'
import { useGameStore } from '@/stores/game'

const { t } = useI18n()
const game = useGameStore()

// A game left via Back is still running in the store; after a reload only storage remembers it.
// Leaving a room never ends its game, so Home offers the way back.
const rememberedRoom = lastRoom()
const hasSavedLocalGame = hasUnfinishedPersistedGame()
const isStoreGameRunning = computed(() => game.gameId !== null && game.status !== 'finished')
const onlineRoomToContinue = computed(() =>
  isStoreGameRunning.value && game.roomCode ? game.roomCode : rememberedRoom,
)
const canContinueLocalGame = computed(
  () => (isStoreGameRunning.value && !game.isOnline) || hasSavedLocalGame,
)
</script>

<template>
  <main
    class="bg-background text-foreground mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 p-4"
  >
    <div class="flex flex-col items-center gap-2 pt-4 text-center">
      <h1
        id="main-heading"
        tabindex="-1"
        class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        {{ t('home.heading') }}
      </h1>
      <p class="text-muted-foreground">{{ t('home.tagline') }}</p>
    </div>
    <section
      v-if="onlineRoomToContinue || canContinueLocalGame"
      aria-labelledby="continue-heading"
      class="bg-card border-border flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="continue-heading" class="text-lg font-semibold">
        {{ t('home.continue.heading') }}
      </h2>
      <Button v-if="onlineRoomToContinue" as-child class="h-11">
        <RouterLink :to="{ name: 'room', params: { code: onlineRoomToContinue } }">
          {{ t('home.continue.room', { code: onlineRoomToContinue }) }}
        </RouterLink>
      </Button>
      <Button v-if="canContinueLocalGame" as-child variant="secondary" class="h-11">
        <RouterLink :to="{ name: 'room', params: { code: LOCAL_GAME_ROUTE_CODE } }">
          {{ t('home.continue.local') }}
        </RouterLink>
      </Button>
    </section>
    <GameSetup />
    <div class="text-muted-foreground flex items-center gap-3 text-sm">
      <span aria-hidden="true" class="bg-border h-px flex-1" />
      {{ t('home.orDivider') }}
      <span aria-hidden="true" class="bg-border h-px flex-1" />
    </div>
    <JoinGame />
    <RouterLink
      :to="{ name: 'stats' }"
      class="text-muted-foreground hover:text-foreground flex h-11 items-center justify-center self-center text-sm underline underline-offset-4"
    >
      {{ t('home.statsLink') }}
    </RouterLink>
  </main>
</template>
