<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import AppMenu from '@/components/menu/AppMenu.vue'
import BackButton from '@/components/header/BackButton.vue'
import LocalGameBadge from '@/components/header/LocalGameBadge.vue'
import RoomCodeBar from '@/components/header/RoomCodeBar.vue'
import { LOCAL_GAME_ROUTE_CODE } from '@/lib/data/local-game-route'
import { useAppUpdateStore } from '@/stores/app-update'
import { useGameStore } from '@/stores/game'

const route = useRoute()
const { t } = useI18n()
const isHome = computed(() => route.name === 'home')
const game = useGameStore()
/** The online room this device is in, while its page is open. */
const headerRoomCode = computed(() =>
  route.name === 'room' && game.roomCode === String(route.params.code) ? game.roomCode : null,
)
const isLocalRoom = computed(
  () =>
    route.name === 'room' &&
    route.params.code === LOCAL_GAME_ROUTE_CODE &&
    game.gameId !== null &&
    !game.isOnline,
)

// Announces each view's heading, for anyone not following the focus move in router/index.ts.
const routeAnnouncement = computed(() => (route.meta.announceKey ? t(route.meta.announceKey) : ''))

const appUpdate = useAppUpdateStore()
const { needRefresh } = storeToRefs(appUpdate)
// Both live regions stay in the DOM, empty until needed: screen readers reliably announce only
// changes to a region that already exists. The visible banner is separate, so its buttons join
// the tab order only while it shows.
const updateAnnouncement = computed(() => (needRefresh.value ? t('app.update.available') : ''))
</script>

<template>
  <!-- Safe-area insets once, on the app frame. -->
  <div
    class="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
  >
    <div aria-live="polite" role="status" class="sr-only">{{ routeAnnouncement }}</div>
    <div aria-live="polite" role="status" class="sr-only">{{ updateAnnouncement }}</div>

    <!-- On every route: Back, the room code in an online room, and the menu. No title link: Back
         already leads home. Sticky: the one part of a page that stays put while it scrolls. -->
    <header
      data-app-header
      class="bg-background sticky top-0 z-20 mx-auto flex h-(--app-header-height) w-full max-w-md items-center gap-1 px-4 pt-2"
    >
      <BackButton v-if="!isHome" class="-ml-2" />
      <RoomCodeBar v-if="headerRoomCode" :code="headerRoomCode" />
      <!-- Home's own heading says the same to screen readers. -->
      <span
        v-else-if="isHome"
        aria-hidden="true"
        class="text-brand flex min-w-0 flex-1 items-center gap-2 text-lg font-semibold"
      >
        <img src="/pwa-192.png" alt="" class="size-8 rounded-md" />
        {{ t('app.title') }}
      </span>
      <div v-else class="min-w-0 flex-1" />
      <LocalGameBadge v-if="isLocalRoom" />
      <AppMenu class="-mr-2" />
    </header>

    <div
      v-if="needRefresh"
      class="bg-muted text-foreground border-border mx-auto flex max-w-md items-center gap-2 rounded-lg border px-4 py-2 text-sm shadow-sm"
    >
      <span class="flex-1">{{ t('app.update.available') }}</span>
      <Button size="sm" class="h-11 px-4" @click="appUpdate.reload">{{
        t('app.update.reload')
      }}</Button>
      <Button
        variant="ghost"
        size="icon"
        class="size-11"
        :aria-label="t('app.update.dismiss')"
        @click="appUpdate.dismiss"
      >
        <X aria-hidden="true" class="size-4" />
      </Button>
    </div>

    <!-- Keyed by path: a room's view state belongs to that room, so the next room after Play
         again starts afresh. -->
    <RouterView v-slot="{ Component, route: current }">
      <component :is="Component" :key="current.path" />
    </RouterView>
  </div>
</template>
