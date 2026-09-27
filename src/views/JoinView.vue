<script setup lang="ts">
/**
 * The page an invite link or QR code opens: /join/CODE. It asks only for a name. A device already
 * seated there goes straight to the room, and a room that has finished, expired or doesn't exist
 * says so instead of offering a join that would fail. If the room can't be read (offline), the
 * form is shown anyway and reports that itself when submitted.
 */
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import JoinGame from '@/components/home/JoinGame.vue'
import { Card } from '@/components/ui/card'
import { useGameConnectivity } from '@/composables/useGameConnectivity'
import type { RoomAvailability } from '@/lib/data/repository'
import { isValidRoomCode, normalizeRoomCode } from '@/lib/game/room-code'
import { useGameStore } from '@/stores/game'

type JoinPageState = 'checking' | 'invalid' | RoomAvailability

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const game = useGameStore()
const { roomCode: activeRoomCode, status } = storeToRefs(game)
const { resumeRepository } = useGameConnectivity()

const code = computed(() => normalizeRoomCode(String(route.params.code)))
const state = ref<JoinPageState>(isValidRoomCode(code.value) ? 'checking' : 'invalid')

const unavailableMessage = computed(() => {
  switch (state.value) {
    case 'finished':
      return t('join.finished')
    case 'expired':
      return t('join.expired')
    case 'missing':
      return t('join.missing', { code: code.value })
    case 'invalid':
      return t('join.invalid')
    default:
      return ''
  }
})

async function goToRoom(): Promise<void> {
  await router.replace({ name: 'room', params: { code: code.value } })
}

/** Seated here already → the room. Otherwise whether the room can still be joined. */
async function checkRoom(): Promise<void> {
  if (activeRoomCode.value === code.value && status.value !== 'finished') return goToRoom()
  const repository = await resumeRepository(code.value)
  if (!repository) {
    state.value = 'open'
    return
  }
  try {
    if (await repository.findSeat()) return goToRoom()
    state.value = await repository.roomAvailability()
  } catch {
    // Couldn't read the room (offline, or the backend refused): the form tries and says why.
    state.value = 'open'
  }
}

onMounted(async () => {
  if (state.value === 'checking') await checkRoom()
})
</script>

<template>
  <main
    class="bg-background text-foreground mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4"
  >
    <h1
      id="main-heading"
      tabindex="-1"
      class="focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none"
    >
      {{ state === 'invalid' ? t('join.headingNoCode') : t('join.heading', { code }) }}
    </h1>
    <p v-if="state === 'checking'" role="status" class="text-muted-foreground">
      {{ t('join.checking') }}
    </p>
    <Card v-else-if="state === 'open'" class="px-4">
      <JoinGame :room-code="code" />
    </Card>
    <template v-else>
      <p>{{ unavailableMessage }}</p>
      <RouterLink :to="{ name: 'home' }" class="text-primary underline underline-offset-4">
        {{ t('join.toHome') }}
      </RouterLink>
    </template>
  </main>
</template>
