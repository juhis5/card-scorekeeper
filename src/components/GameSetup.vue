<script setup lang="ts">
/**
 * The home-screen form: sets the host's display name, collects the other players' names, and
 * starts a new LOCAL (offline) game — building a `LocalGameRepository` and handing it to
 * `useGameStore().start()`. This is the only place in slice 3 that constructs a repository;
 * everything downstream (RoomView and its children) only ever talks to the store.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Plus, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LocalGameRepository } from '@/lib/local-repository'
import { useGameStore } from '@/stores/game'
import { useIdentityStore } from '@/stores/identity'

interface OtherPlayerField {
  id: string
  name: string
}

const { t } = useI18n()
const router = useRouter()
const identity = useIdentityStore()
const game = useGameStore()

const hostName = ref(identity.displayName)
const otherPlayers = ref<OtherPlayerField[]>([{ id: crypto.randomUUID(), name: '' }])
const attemptedSubmit = ref(false)
const isSubmitting = ref(false)
const submitError = ref('')

const trimmedHostName = computed(() => hostName.value.trim())
const namedOtherPlayers = computed(() =>
  otherPlayers.value.map((field) => field.name.trim()).filter((name) => name.length > 0),
)
const isHostNameInvalid = computed(() => attemptedSubmit.value && trimmedHostName.value === '')
const areOtherPlayersInvalid = computed(
  () => attemptedSubmit.value && namedOtherPlayers.value.length === 0,
)

function addPlayerField(): void {
  otherPlayers.value.push({ id: crypto.randomUUID(), name: '' })
}

function removePlayerField(id: string): void {
  otherPlayers.value = otherPlayers.value.filter((field) => field.id !== id)
}

async function startLocalGame(): Promise<void> {
  identity.setDisplayName(trimmedHostName.value)
  await game.start(new LocalGameRepository(), {
    hostDeviceUuid: identity.deviceUuid,
    hostDisplayName: trimmedHostName.value,
  })
  // Local (offline) play has no other real devices — each added player gets its own synthetic
  // id so their stats stay distinguishable from the host's, rather than aliasing hostDeviceUuid.
  for (const name of namedOtherPlayers.value) {
    await game.addPlayer({ name, deviceUuid: crypto.randomUUID() })
  }
  await router.push({ name: 'room', params: { code: 'local' } })
}

async function handleSubmit(): Promise<void> {
  attemptedSubmit.value = true
  if (isHostNameInvalid.value || namedOtherPlayers.value.length === 0 || isSubmitting.value) return

  isSubmitting.value = true
  submitError.value = ''
  try {
    await startLocalGame()
  } catch {
    submitError.value = t('home.errors.startFailed')
  } finally {
    isSubmitting.value = false
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
