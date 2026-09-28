<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import GameSetup from '@/components/home/GameSetup.vue'
import LeaveGameButton from '@/components/home/LeaveGameButton.vue'
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue'
import JoinGame from '@/components/home/JoinGame.vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { lastRoom } from '@/lib/data/last-room'
import { LOCAL_GAME_ROUTE_CODE } from '@/lib/data/local-game-route'
import { hasUnfinishedPersistedGame } from '@/lib/data/local-repository'
import { useGameStore } from '@/stores/game'
import { useIdentityStore } from '@/stores/identity'

const { t } = useI18n()
const game = useGameStore()
const identity = useIdentityStore()

/** Liity first: most players join a game someone else started. */
const PLAY_MODES = ['join', 'new'] as const
const mode = ref<(typeof PLAY_MODES)[number]>('join')
/** One name for both, so switching modes keeps what was typed. */
const playerName = ref(identity.displayName)

// Leaving a room never ends its game, so Home offers the way back: from the store, or from
// storage after a reload.
const rememberedRoom = ref(lastRoom())
const hasSavedLocalGame = ref(hasUnfinishedPersistedGame())
const isStoreGameRunning = computed(
  () => game.gameId !== null && (game.status === 'waiting' || game.status === 'playing'),
)

/** After ✕: read again what's left to continue. */
function refreshGamesInProgress(): void {
  rememberedRoom.value = lastRoom()
  hasSavedLocalGame.value = hasUnfinishedPersistedGame()
}
const onlineRoomToContinue = computed(() =>
  isStoreGameRunning.value && game.roomCode ? game.roomCode : rememberedRoom.value,
)
const canContinueLocalGame = computed(
  () => (isStoreGameRunning.value && !game.isOnline) || hasSavedLocalGame.value,
)
</script>

<template>
  <main
    class="bg-background text-foreground mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4"
  >
    <!-- Screen-reader only: navigation focuses it, but on a phone the forms need the space. -->
    <h1 id="main-heading" tabindex="-1" class="sr-only">{{ t('home.heading') }}</h1>
    <section
      v-if="onlineRoomToContinue || canContinueLocalGame"
      aria-labelledby="continue-heading"
      class="bg-card border-border flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="continue-heading" class="text-lg font-semibold">
        {{ t('home.continue.heading') }}
      </h2>
      <div v-if="onlineRoomToContinue" class="flex gap-2">
        <Button as-child class="h-11 flex-1">
          <RouterLink :to="{ name: 'room', params: { code: onlineRoomToContinue } }">
            {{ t('home.continue.room', { code: onlineRoomToContinue }) }}
          </RouterLink>
        </Button>
        <LeaveGameButton :room-code="onlineRoomToContinue" @left="refreshGamesInProgress" />
      </div>
      <div v-if="canContinueLocalGame" class="flex gap-2">
        <Button as-child variant="secondary" class="h-11 flex-1">
          <RouterLink :to="{ name: 'room', params: { code: LOCAL_GAME_ROUTE_CODE } }">
            {{ t('home.continue.local') }}
          </RouterLink>
        </Button>
        <LeaveGameButton @left="refreshGamesInProgress" />
      </div>
    </section>
    <!-- One card: join or start a game, sharing one name field. -->
    <Card class="gap-4 px-4">
      <SegmentedToggle
        v-model="mode"
        :label="t('home.play.label')"
        :options="PLAY_MODES.map((option) => ({ value: option, label: t(`home.play.${option}`) }))"
      />
      <JoinGame v-if="mode === 'join'" v-model:name="playerName" />
      <GameSetup v-else v-model:name="playerName" />
    </Card>
  </main>
</template>
