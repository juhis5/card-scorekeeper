<script setup lang="ts">
/**
 * The home-screen "host" form: name your game and start it. On submit, probes backend
 * reachability (see `useGameConnectivity`/`lib/game-mode.ts`) and picks the repository — online
 * (Firestore, a real room code others join with) when reachable, local single-device otherwise.
 * This is the only place that constructs a repository; everything downstream (RoomView and its
 * children) only ever talks to the store.
 *
 * The "other players" fields only matter for the offline fallback — online, other players join
 * later via the room code, not by the host typing their names upfront (see docs/PLAN.md's "Reachable
 * → normal synced room ... players join by code"; also, `FirestoreGameRepository.addPlayer` seats
 * *this device's own* auth uid, so the host looping it for named players would be wrong online,
 * not just unnecessary). Which path we're on isn't known until the probe resolves, so "at least one
 * other player" is enforced only once we learn we're local — never blocking an online host from
 * starting solo and waiting for joiners.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Plus, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useGameConnectivity } from '@/composables/useGameConnectivity'
import { useGameStore } from '@/stores/game'
import { useIdentityStore } from '@/stores/identity'
import { LOCAL_GAME_ROUTE_CODE } from '@/lib/local-game-route'
import type { HostGameMode } from '@/lib/game-mode'
import { MAX_PLAYER_NAME_LENGTH } from '@/lib/rules'

interface OtherPlayerField {
  id: string
  name: string
}

const { t } = useI18n()
const router = useRouter()
const identity = useIdentityStore()
const game = useGameStore()
const { hostRepository, localRepository } = useGameConnectivity()

const hostName = ref(identity.displayName)
const otherPlayers = ref<OtherPlayerField[]>([{ id: crypto.randomUUID(), name: '' }])
const attemptedSubmit = ref(false)
const areOtherPlayersInvalid = ref(false)
const isSubmitting = ref(false)
const isCheckingConnection = ref(false)
const submitError = ref('')

const trimmedHostName = computed(() => hostName.value.trim())
const namedOtherPlayers = computed(() =>
  otherPlayers.value.map((field) => field.name.trim()).filter((name) => name.length > 0),
)
const isHostNameInvalid = computed(() => attemptedSubmit.value && trimmedHostName.value === '')

function addPlayerField(): void {
  otherPlayers.value.push({ id: crypto.randomUUID(), name: '' })
}

function removePlayerField(id: string): void {
  otherPlayers.value = otherPlayers.value.filter((field) => field.id !== id)
}

/** The offline fallback is a single device with no remote join, so it needs at least one other
 * named player up front; online hosting doesn't (see the file-level comment above). */
function isMissingRequiredOtherPlayers(mode: HostGameMode): boolean {
  return mode.kind === 'offline' && namedOtherPlayers.value.length === 0
}

async function startGame(mode: HostGameMode): Promise<void> {
  identity.setDisplayName(trimmedHostName.value)
  await game.start(mode.repository, {
    hostDeviceUuid: identity.deviceUuid,
    hostDisplayName: trimmedHostName.value,
  })
  if (mode.kind === 'offline') {
    // Local (offline) play has no other real devices — each added player gets its own synthetic
    // id so their stats stay distinguishable from the host's, rather than aliasing hostDeviceUuid.
    for (const name of namedOtherPlayers.value) {
      await game.addPlayer({ name, deviceUuid: crypto.randomUUID() })
    }
  }
  const roomCodeParam =
    mode.kind === 'online' ? (game.roomCode ?? LOCAL_GAME_ROUTE_CODE) : LOCAL_GAME_ROUTE_CODE
  await router.push({ name: 'room', params: { code: roomCodeParam } })
}

/** Starts the chosen game. If the online room can't be created (the check passed, then the write
 * failed or timed out), play locally instead, exactly like an unreachable backend. */
async function startOrFallBack(mode: HostGameMode): Promise<void> {
  if (isMissingRequiredOtherPlayers(mode)) {
    areOtherPlayersInvalid.value = true
    return
  }
  try {
    await startGame(mode)
  } catch (error) {
    if (mode.kind !== 'online') throw error
    await startOrFallBack(localRepository())
  }
}

async function handleSubmit(): Promise<void> {
  attemptedSubmit.value = true
  areOtherPlayersInvalid.value = false
  if (isHostNameInvalid.value || isSubmitting.value) return

  isSubmitting.value = true
  isCheckingConnection.value = true
  submitError.value = ''
  try {
    const mode = await hostRepository()
    isCheckingConnection.value = false
    await startOrFallBack(mode)
  } catch {
    submitError.value = t('home.errors.startFailed')
  } finally {
    isSubmitting.value = false
    isCheckingConnection.value = false
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="handleSubmit">
    <Card>
      <CardHeader>
        <CardTitle>{{ t('home.form.heading') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <Label for="host-name">{{ t('home.form.hostNameLabel') }}</Label>
          <Input
            id="host-name"
            v-model="hostName"
            :maxlength="MAX_PLAYER_NAME_LENGTH"
            type="text"
            autocomplete="name"
            enterkeyhint="next"
            class="h-11 text-base"
            :placeholder="t('home.form.hostNamePlaceholder')"
            :aria-invalid="isHostNameInvalid"
            :aria-describedby="isHostNameInvalid ? 'host-name-error' : undefined"
          />
          <p v-if="isHostNameInvalid" id="host-name-error" class="text-destructive text-sm">
            {{ t('home.errors.hostNameRequired') }}
          </p>
        </div>

        <fieldset class="flex flex-col gap-2">
          <legend class="text-sm font-medium">{{ t('home.form.otherPlayersHeading') }}</legend>
          <p class="text-muted-foreground text-sm">{{ t('home.form.otherPlayersHint') }}</p>

          <p v-if="otherPlayers.length === 0" class="text-muted-foreground text-sm">
            {{ t('home.form.otherPlayersEmpty') }}
          </p>

          <div v-for="(field, index) in otherPlayers" :key="field.id" class="flex items-end gap-2">
            <div class="flex flex-1 flex-col gap-1.5">
              <Label :for="`player-name-${field.id}`">
                {{ t('home.form.nameLabel', { number: index + 1 }) }}
              </Label>
              <Input
                :id="`player-name-${field.id}`"
                v-model="field.name"
                :maxlength="MAX_PLAYER_NAME_LENGTH"
                type="text"
                class="h-11 text-base"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-11 shrink-0"
              :aria-label="t('home.form.removeLabel', { number: index + 1 })"
              @click="removePlayerField(field.id)"
            >
              <X aria-hidden="true" class="size-4" />
            </Button>
          </div>

          <p v-if="areOtherPlayersInvalid" role="alert" class="text-destructive text-sm">
            {{ t('home.errors.otherPlayersRequired') }}
          </p>

          <Button type="button" variant="outline" class="h-11 self-start" @click="addPlayerField">
            <Plus aria-hidden="true" class="size-4" />
            {{ t('home.form.addPlayerButton') }}
          </Button>
        </fieldset>
      </CardContent>
      <CardFooter class="flex flex-col gap-2">
        <p v-if="isCheckingConnection" role="status" class="text-muted-foreground text-sm">
          {{ t('home.form.checkingConnection') }}
        </p>
        <p v-if="submitError" role="alert" class="text-destructive text-sm">{{ submitError }}</p>
        <Button
          type="submit"
          class="h-11 w-full"
          :disabled="isSubmitting"
          :aria-busy="isSubmitting"
        >
          {{ t('home.form.startButton') }}
        </Button>
      </CardFooter>
    </Card>
  </form>
</template>
