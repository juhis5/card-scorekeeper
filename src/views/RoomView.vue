<script setup lang="ts">
/**
 * The live scoreboard. The host enters any score and drives Next/Finish; a joiner edits only
 * their own row, as firestore.rules enforces. Never gate on `status === 'playing'`: online it
 * stays 'waiting' until the first advanceRound(), so gating on it would hide round 1.
 */
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useEventListener } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'
import { ListChecks, WifiOff } from '@lucide/vue'
import AddPlayerCard from '@/components/room/AddPlayerCard.vue'
import ContractBanner from '@/components/room/ContractBanner.vue'
import EnterAllScoresSheet from '@/components/room/EnterAllScoresSheet.vue'
import GameHighscores from '@/components/room/GameHighscores.vue'
import PlayAgain from '@/components/room/PlayAgain.vue'
import RemovePlayerControl from '@/components/room/RemovePlayerControl.vue'
import ScoreCard from '@/components/room/ScoreCard.vue'
import ScoreBoard from '@/components/room/ScoreBoard.vue'
import WinnerBanner from '@/components/room/WinnerBanner.vue'
import { winnerMessage } from '@/components/room/winner-message'
import { Button } from '@/components/ui/button'
import { useConnectionStatus } from '@/composables/useConnectionStatus'
import { useGameConnectivity } from '@/composables/useGameConnectivity'
import { provideOpenCard } from '@/composables/useSingleOpenCard'
import { LOCAL_GAME_ROUTE_CODE } from '@/lib/data/local-game-route'
import {
  canCloseRound,
  isEveryRoundScored,
  missingRounds,
  pointsFor,
  roundsWithoutWinner,
  roundsWithSeveralZeros,
  TOTAL_ROUNDS,
} from '@/lib/game/rules'
import { isPermissionDenied, isUnavailable } from '@/lib/data/write-errors'
import { celebrate } from '@/lib/platform/celebrate'
import { TimeoutError, withTimeout } from '@/lib/platform/timeout'
import { useGameStore } from '@/stores/game'
import type { PlayerId } from '@/lib/data/repository'
import type { ContractRoundNumber, Player, Standing } from '@/lib/game/types'

const i18n = useI18n()
const { t, n, locale } = i18n
provideOpenCard()
const route = useRoute()
const game = useGameStore()
const {
  gameId,
  standings,
  board,
  currentContract,
  currentRound,
  completedRounds,
  status,
  winners,
  roundScores,
  isHost,
  myPlayerId,
  isOnline,
  roomCode,
  connectionError,
} = storeToRefs(game)
const { resumeRepository } = useGameConnectivity()
// A blip in a live room, not the never-connected offline banner.
const { isReconnecting } = useConnectionStatus()

const announcement = ref('')
/** Why the last score, Next or Finish didn't save. Cleared by the next save that succeeds. */
const saveError = ref('')
const isAdvancing = ref(false)
const scoreEntryHeading = useTemplateRef<HTMLHeadingElement>('scoreEntryHeading')
const isFinishing = ref(false)

// Entry cards keep a fixed seat order: `standings` re-sorts after every save and would slide a
// row from under a thumb. It grows as players appear, since online they arrive after mount.
const seatOrder = ref<PlayerId[]>([])
watch(
  standings,
  (list) => {
    for (const standing of list) {
      if (!seatOrder.value.includes(standing.player.id)) {
        seatOrder.value.push(standing.player.id)
      }
    }
  },
  { immediate: true },
)
const seatedStandings = computed(() =>
  seatOrder.value
    .map((playerId) => standings.value.find((standing) => standing.player.id === playerId))
    .filter((standing): standing is Standing => standing !== undefined),
)
const entryStandings = computed(() =>
  isHost.value
    ? seatedStandings.value
    : seatedStandings.value.filter((standing) => standing.player.id === myPlayerId.value),
)
/** Names Play again carries over: this device's own, then the others in seat order. */
const myName = computed(
  () =>
    seatedStandings.value.find(({ player }) => player.id === myPlayerId.value)?.player.name ?? '',
)
const otherNames = computed(() =>
  seatedStandings.value
    .filter(({ player }) => player.id !== myPlayerId.value)
    .map(({ player }) => player.name),
)

/** Players the host can still enter this round's score for: what "Syötä kaikki" goes through. */
const missingThisRound = computed(() =>
  entryStandings.value
    .map(({ player }) => player)
    .filter((player) => pointsFor(player.id, currentRound.value, roundScores.value) === null),
)
const isEnterAllOpen = ref(false)

/** Earlier rounds a late joiner still has to fill in, so nobody is ranked on fewer rounds. */
const missedRoundCards = computed(() =>
  entryStandings.value.flatMap(({ player }) =>
    missingRounds(player.id, roundScores.value, currentRound.value)
      .filter((round) => round < currentRound.value)
      .map((round) => ({ player, round })),
  ),
)

const hasActiveGame = computed(() => standings.value.length > 0)
const isFinalRound = computed(() => currentRound.value === TOTAL_ROUNDS)
const isFinished = computed(() => status.value === 'finished')
// Every round so far, not just the current one: a late joiner's missed rounds block Next too.
const allPlayersScored = computed(() =>
  isEveryRoundScored(
    standings.value.map((standing) => standing.player.id),
    roundScores.value,
    currentRound.value,
  ),
)
const roundsToCheck = computed(() =>
  roundsWithSeveralZeros(
    standings.value.map((standing) => standing.player.id),
    roundScores.value,
    currentRound.value,
  ),
)
const roundsWithNoWinner = computed(() =>
  roundsWithoutWinner(
    standings.value.map((standing) => standing.player.id),
    roundScores.value,
    currentRound.value,
  ),
)
function listRounds(rounds: readonly number[]): string {
  return new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(
    rounds.map((round) => n(round)),
  )
}
const roundsToCheckText = computed(() => listRounds(roundsToCheck.value))
const roundsWithNoWinnerText = computed(() => listRounds(roundsWithNoWinner.value))
const hasEnteredOwnScores = computed(
  () =>
    myPlayerId.value !== null &&
    missingRounds(myPlayerId.value, roundScores.value, currentRound.value).length === 0,
)
/** Exactly one 0 per round: the player who went out. */
const canAdvance = computed(() =>
  canCloseRound(
    standings.value.map((standing) => standing.player.id),
    roundScores.value,
    currentRound.value,
  ),
)

/** Scores entered on this device, as "playerId-round": the host sees those numbers on others'
 * cards, while scores players entered themselves read "scored" until the reveal. Lost on reload. */
const scoresEnteredHere = ref(new Set<string>())

function scoreKey(playerId: PlayerId, round: ContractRoundNumber): string {
  return `${playerId}-${round}`
}

function canSeePoints(player: Player, round: ContractRoundNumber): boolean {
  return (
    player.id === myPlayerId.value ||
    player.isGuest === true ||
    scoresEnteredHere.value.has(scoreKey(player.id, round))
  )
}

/** A non-host player's own card reads "Enter your points"; the host sees names on every card. */
function isOwnCard(playerId: PlayerId): boolean {
  return !isHost.value && playerId === myPlayerId.value
}

/** True while this device saves or removes a player: that change announces "all scored" itself,
 * so the watcher below stays quiet instead of racing it. */
let isLocalChangeInFlight = false
let pendingSave: Promise<void> = Promise.resolve()
/** How long Next and Finish wait for a just-saved score before saying there's no connection. */
const PENDING_SAVE_WAIT_MS = 5_000
/** Shown when Next or Finish is tapped before every score is in. */
const isWaitingHintShown = ref(false)
const waitingForNames = computed(() =>
  new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(
    standings.value
      .filter(
        ({ player }) => missingRounds(player.id, roundScores.value, currentRound.value).length > 0,
      )
      .map(({ player }) => player.name),
  ),
)

/** Clears the live region first, so the same words said twice are announced twice. */
async function announce(message: string): Promise<void> {
  announcement.value = ''
  await nextTick()
  announcement.value = message
}

function allScoredMessage(): string {
  return t('room.live.allScored', { round: n(currentRound.value) })
}

/** One message on every device when a round is revealed; the contract banner stays quiet. */
function revealMessage(round: number): string {
  const leaders = board.value.filter((row) => row.placement === 1)
  const names = new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(
    leaders.map((row) => row.player.name),
  )
  const results =
    leaders.length === 0
      ? ''
      : t(
          'room.live.roundResults',
          { round: n(round), names, total: n(leaders[0]?.total ?? 0) },
          leaders.length,
        )
  const myPlacement = board.value.find((row) => row.player.id === myPlayerId.value)?.placement
  const place = myPlacement ? t('room.live.yourPlacement', { placement: n(myPlacement) }) : ''
  const nextRound = t('room.roundBanner', {
    round: n(currentRound.value),
    total: n(TOTAL_ROUNDS),
    contract: t(currentContract.value.contractKey),
  })
  return [results, place, nextRound].filter((part) => part !== '').join(' ')
}

// Announce each reveal once, but not on opening or resuming a room: the board already shows it.
// The last reveal is the finish: its announcement is the winner.
let revealBaseline: { gameId: string | null; completed: number } | null = null
watch(
  [gameId, completedRounds, hasActiveGame],
  ([id, completed, isActive]) => {
    if (!isActive) {
      revealBaseline = null
      return
    }
    const isNewReveal =
      revealBaseline !== null &&
      revealBaseline.gameId === id &&
      completed > revealBaseline.completed
    revealBaseline = { gameId: id, completed }
    if (!isNewReveal) return
    if (status.value !== 'finished') {
      void announce(revealMessage(completed))
      return
    }
    void announce(winnerMessage(i18n, winners.value))
    // Only a finish seen live, on every phone, never when a finished room is reopened.
    void celebrate()
  },
  { immediate: true },
)

// The host hears when another device sends the last score; its own saves say so themselves.
watch(allPlayersScored, (isReady, wasReady) => {
  if (isReady) isWaitingHintShown.value = false
  if (isReady && !wasReady && isHost.value && hasActiveGame.value && !isLocalChangeInFlight) {
    void announce(allScoredMessage())
  }
})

function canRemove(playerId: PlayerId): boolean {
  return isHost.value && playerId !== myPlayerId.value
}

/** The rules refuse every write to an expired room; a timeout means no connection; any other
 * failure is worth retrying. */
function describeSaveFailure(error: unknown, retryMessage: string): string {
  if (isPermissionDenied(error)) return t('room.saveError.closed')
  if (error instanceof TimeoutError) return t('room.saveError.offline')
  return retryMessage
}

/** Resolves false when the score didn't save (the reason is in `saveError`). */
async function handleScoreCommit(
  playerId: PlayerId,
  round: ContractRoundNumber,
  points: number,
): Promise<boolean> {
  const saving = saveScore(playerId, round, points)
  pendingSave = saving.then(() => undefined)
  return saving
}

async function saveScore(
  playerId: PlayerId,
  round: ContractRoundNumber,
  points: number,
): Promise<boolean> {
  const player = standings.value.find((standing) => standing.player.id === playerId)?.player
  isLocalChangeInFlight = true
  try {
    await game.setRoundScore({ playerId, round, points })
  } catch (error) {
    saveError.value = describeSaveFailure(
      error,
      t('room.saveError.score', { name: player?.name ?? '' }),
    )
    return false
  } finally {
    isLocalChangeInFlight = false
  }
  saveError.value = ''
  scoresEnteredHere.value.add(scoreKey(playerId, round))
  if (!player) return true

  // No ranking here: numbers stay hidden from the board until the round is revealed.
  const saved = t('room.live.scoreSaved', { name: player.name, points: n(points) })
  void announce(isHost.value && allPlayersScored.value ? `${saved} ${allScoredMessage()}` : saved)
  return true
}

function handlePlayerAdded(name: string): void {
  void announce(t('room.live.playerAdded', { name }))
}

async function handleRemovePlayer(player: Player): Promise<void> {
  isLocalChangeInFlight = true
  try {
    await game.removePlayer(player.id)
  } catch (error) {
    saveError.value = describeSaveFailure(error, t('room.saveError.remove', { name: player.name }))
    return
  } finally {
    isLocalChangeInFlight = false
  }
  saveError.value = ''
  const removed = t('room.live.playerRemoved', { name: player.name })
  void announce(allPlayersScored.value ? `${removed} ${allScoredMessage()}` : removed)
  // The removed player's card (and the focused control in it) is gone; keep the host's place.
  await nextTick()
  scoreEntryHeading.value?.focus()
}

/** Waits, briefly, for a score saved just before the tap. Offline the save never settles, so
 * this gives up and says so rather than advancing later on its own. */
async function isReadyToAdvance(): Promise<boolean> {
  try {
    await withTimeout(pendingSave, PENDING_SAVE_WAIT_MS)
  } catch (error) {
    if (!(error instanceof TimeoutError)) throw error
    saveError.value = t('room.saveError.offline')
    return false
  }
  isWaitingHintShown.value = !allPlayersScored.value
  return canAdvance.value
}

/** Back to the "Enter all" button, or to the round heading once nobody is left to enter. */
async function restoreFocusAfterEnterAll(): Promise<void> {
  await nextTick()
  const opener = document.querySelector<HTMLElement>('[data-enter-all]')
  ;(opener ?? scoreEntryHeading.value)?.focus()
}

/** Busy before the first await, so taps made while a save settles can't advance twice. */
async function handleNextRound(): Promise<void> {
  if (isAdvancing.value) return
  isAdvancing.value = true
  try {
    if (!(await isReadyToAdvance())) return
    await game.advanceRound()
    saveError.value = ''
    // The new round's heading, not <body>: the tapped button stays, but its round is gone.
    await nextTick()
    scoreEntryHeading.value?.focus()
  } catch (error) {
    saveError.value = describeSaveFailure(error, t('room.saveError.nextRound'))
  } finally {
    isAdvancing.value = false
  }
}

async function handleFinish(): Promise<void> {
  if (isFinishing.value) return
  isFinishing.value = true
  try {
    if (!(await isReadyToAdvance())) return
    // No announcement here: the reveal watcher announces the winner on every device.
    await game.finishGame()
    saveError.value = ''
    // Finish and the score cards are gone: the page heading keeps the host's place.
    await nextTick()
    document.getElementById('main-heading')?.focus()
  } catch (error) {
    saveError.value = describeSaveFailure(error, t('room.saveError.finish'))
  } finally {
    isFinishing.value = false
  }
}

const routeCode = computed(() => String(route.params.code))
/** Resuming an online room after a reload: 'opening' while this device's seat is looked up,
 * 'not-seated' when it has none there, 'unreachable' when it couldn't be looked up offline. */
const resumeState = ref<'idle' | 'opening' | 'not-seated' | 'unreachable'>('idle')
// Online, the store knows the room before its first snapshot arrives (just after joining, or
// resuming), so "no players yet" means "still opening", not "no game".
const isOpeningRoom = computed(
  () =>
    resumeState.value === 'opening' ||
    (isOnline.value && !hasActiveGame.value && connectionError.value === null),
)

const isAbandoned = computed(() => status.value === 'abandoned')
const isGameShown = computed(
  () =>
    !isOpeningRoom.value &&
    (resumeState.value === 'idle' || resumeState.value === 'opening') &&
    hasActiveGame.value &&
    !isAbandoned.value,
)
const heading = computed(() => {
  if (isOpeningRoom.value) return t('room.opening', { code: routeCode.value })
  if (resumeState.value === 'not-seated') return t('room.notSeated.heading')
  if (resumeState.value === 'unreachable') return t('room.unreachable.heading')
  if (isAbandoned.value) return t('room.end.endedTitle')
  if (!hasActiveGame.value) return t('room.empty.heading')
  return t('room.heading')
})

/** Offline on a cold cache the seat lookup fails: that's "no connection", not "not seated". */
async function resumeOnlineRoom(code: string): Promise<void> {
  resumeState.value = 'opening'
  const repository = await resumeRepository(code)
  if (!repository) {
    resumeState.value = navigator.onLine ? 'not-seated' : 'unreachable'
    return
  }
  try {
    resumeState.value = (await game.resumeOnline(repository, code)) ? 'idle' : 'not-seated'
  } catch (error) {
    resumeState.value = !navigator.onLine || isUnavailable(error) ? 'unreachable' : 'not-seated'
  }
}

useEventListener(window, 'online', () => {
  if (resumeState.value === 'unreachable') void resumeOnlineRoom(routeCode.value)
})

/** Whether the store already holds the game this address names: the local one, or this room. */
const isStoreOnThisGame = computed(() =>
  routeCode.value === LOCAL_GAME_ROUTE_CODE
    ? game.gameId !== null && !isOnline.value
    : roomCode.value === routeCode.value,
)

// A reload empties the store. The local sentinel resumes the localStorage game, a room code this
// device's online seat. Never mixed: another game open in the store (Home's other "continue")
// is left first; a local one stays saved, an online one stays remembered.
onMounted(async () => {
  if (isStoreOnThisGame.value) return
  if (game.gameId !== null) game.leave()
  if (routeCode.value === LOCAL_GAME_ROUTE_CODE) {
    game.resume()
    return
  }
  await resumeOnlineRoom(routeCode.value)
})
</script>

<template>
  <!-- On touch, space below an open card lets even the last one scroll up (useKeepInView). -->
  <main
    class="group/room mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4 pointer-coarse:has-[[data-card-open]]:pb-(--open-card-room)"
  >
    <!-- One heading for every state: navigation focuses it before the first snapshot, and a new
         element per state would drop that focus. Screen-reader only while a game shows. -->
    <h1
      id="main-heading"
      tabindex="-1"
      :class="
        isGameShown
          ? 'sr-only'
          : 'focus-visible:ring-ring rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:outline-none'
      "
    >
      {{ heading }}
    </h1>

    <!-- While the room opens, the heading alone says so. -->
    <template v-if="isOpeningRoom" />

    <p v-else-if="resumeState === 'unreachable'" class="text-muted-foreground">
      {{ t('room.unreachable.body') }}
    </p>

    <template v-else-if="resumeState === 'not-seated'">
      <p class="text-muted-foreground">{{ t('room.notSeated.body') }}</p>
      <RouterLink
        :to="{ name: 'join', params: { code: routeCode } }"
        class="text-primary underline underline-offset-4"
      >
        {{ t('room.notSeated.join', { code: routeCode }) }}
      </RouterLink>
    </template>

    <template v-else-if="isAbandoned">
      <p role="status" class="text-muted-foreground">{{ t('room.end.endedBody') }}</p>
      <RouterLink :to="{ name: 'home' }" class="text-primary underline underline-offset-4">
        {{ t('room.empty.backHome') }}
      </RouterLink>
    </template>

    <template v-else-if="!hasActiveGame">
      <p class="text-muted-foreground">{{ t('room.empty.body') }}</p>
      <RouterLink :to="{ name: 'home' }" class="text-primary underline underline-offset-4">
        {{ t('room.empty.backHome') }}
      </RouterLink>
    </template>

    <template v-else>
      <p
        v-if="isOnline && isReconnecting"
        role="status"
        class="bg-muted text-foreground border-border flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
      >
        <WifiOff aria-hidden="true" class="size-4 shrink-0" />
        {{ t('room.online.reconnecting') }}
      </p>
      <!-- Seen as the header's icon (LocalGameBadge); said once here for screen readers. -->
      <p v-else-if="!isOnline" role="status" class="sr-only">{{ t('room.offline.banner') }}</p>

      <p
        v-if="connectionError"
        role="alert"
        class="bg-muted text-foreground border-border flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
      >
        <WifiOff aria-hidden="true" class="size-4 shrink-0" />
        {{
          connectionError === 'removed' ? t('room.connection.removed') : t('room.connection.lost')
        }}
      </p>

      <ContractBanner :round="currentRound" :contract-key="currentContract.contractKey" />

      <ScoreBoard :rows="board" :completed-rounds="completedRounds" />

      <WinnerBanner v-if="isFinished" :winners="winners" />
      <!-- Only online games reach the public lists. -->
      <GameHighscores v-if="isFinished && isOnline && roomCode" :game-id="roomCode" />

      <section
        v-if="!isFinished && missedRoundCards.length > 0"
        aria-labelledby="missed-rounds-heading"
        class="flex flex-col gap-2"
      >
        <h2 id="missed-rounds-heading" class="text-lg font-semibold">
          {{ t('room.score.missedHeading') }}
        </h2>
        <p class="text-muted-foreground text-sm">{{ t('room.score.missedHint') }}</p>
        <ul role="list" class="flex flex-col gap-3">
          <ScoreCard
            v-for="card in missedRoundCards"
            :key="`${card.player.id}-${card.round}`"
            :player="card.player"
            :round="card.round"
            :is-own-card="isOwnCard(card.player.id)"
            is-missed-round
            @commit="handleScoreCommit"
          />
        </ul>
      </section>

      <section v-if="!isFinished" aria-labelledby="score-entry-heading" class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <h2
            id="score-entry-heading"
            ref="scoreEntryHeading"
            tabindex="-1"
            class="focus-visible:ring-ring rounded-sm text-lg font-semibold focus-visible:ring-2 focus-visible:outline-none"
          >
            {{ t('room.score.sectionHeading', { round: n(currentRound) }) }}
          </h2>
          <Button
            v-if="isHost && missingThisRound.length > 0"
            variant="outline"
            class="h-11 shrink-0"
            data-enter-all
            @click="isEnterAllOpen = true"
          >
            <ListChecks aria-hidden="true" class="size-4" />
            {{ t('room.enterAll.button') }}
          </Button>
        </div>
        <EnterAllScoresSheet
          v-if="isHost"
          v-model:open="isEnterAllOpen"
          :players="missingThisRound"
          @closed="restoreFocusAfterEnterAll"
          :round="currentRound"
          :save="handleScoreCommit"
        />
        <!-- role="list": Tailwind's list reset makes Safari/VoiceOver drop <ul> semantics. -->
        <ul role="list" class="flex flex-col gap-3">
          <ScoreCard
            v-for="standing in entryStandings"
            :key="`${standing.player.id}-${currentRound}`"
            :player="standing.player"
            :round="currentRound"
            :scored-points="pointsFor(standing.player.id, currentRound, roundScores)"
            :show-points="canSeePoints(standing.player, currentRound)"
            :is-own-card="isOwnCard(standing.player.id)"
            :can-use-photo-count="isOnline && standing.player.id === myPlayerId"
            :room-code="roomCode"
            @commit="handleScoreCommit"
          >
            <template v-if="canRemove(standing.player.id)" #actions>
              <RemovePlayerControl
                :player-name="standing.player.name"
                @remove="handleRemovePlayer(standing.player)"
              />
            </template>
          </ScoreCard>
          <AddPlayerCard v-if="isHost" @added="handlePlayerAdded" />
        </ul>
      </section>

      <p
        v-if="saveError"
        role="alert"
        class="text-destructive animate-in fade-in-0 text-sm duration-(--dur) motion-reduce:animate-none"
      >
        {{ saveError }}
      </p>

      <div aria-live="polite" class="sr-only">{{ announcement }}</div>

      <p
        v-if="isHost && isWaitingHintShown && !allPlayersScored"
        role="status"
        class="text-muted-foreground text-sm"
      >
        {{ t('room.next.waiting', { names: waitingForNames }) }}
      </p>
      <p v-if="isHost && roundsToCheck.length > 0" role="status" class="text-destructive text-sm">
        {{ t('room.next.severalZeros', { rounds: roundsToCheckText }) }}
      </p>
      <p
        v-if="isHost && roundsWithNoWinner.length > 0"
        role="status"
        class="text-destructive text-sm"
      >
        {{ t('room.next.noWinner', { rounds: roundsWithNoWinnerText }) }}
      </p>

      <!-- Not sticky while a card is open: with the keyboard up, an iPhone shows sticky bars
           right above it, over the field being typed into. -->
      <div
        v-if="isFinished"
        data-bottom-bar
        class="bg-background sticky bottom-0 mt-auto pt-2 pb-2 group-has-[[data-card-open]]/room:static"
      >
        <PlayAgain :my-name="myName" :other-names="otherNames" />
      </div>
      <!-- aria-disabled rather than disabled: the tap must still reach the handler, which waits
           for a score saved by that same tap before deciding. -->
      <div
        v-else-if="isHost"
        data-bottom-bar
        class="bg-background sticky bottom-0 mt-auto flex gap-2 pt-2 pb-2 group-has-[[data-card-open]]/room:static"
      >
        <Button
          v-if="!isFinalRound"
          class="h-11 flex-1 aria-disabled:opacity-50"
          :aria-disabled="!canAdvance || isAdvancing"
          @click="handleNextRound"
        >
          {{ t('room.next.button') }}
        </Button>
        <Button
          v-else
          class="h-11 flex-1 aria-disabled:opacity-50"
          :aria-disabled="!canAdvance || isFinishing"
          @click="handleFinish"
        >
          {{ t('room.finish.button') }}
        </Button>
      </div>
      <!-- Only once this player's own points are in: before that, there's nothing to wait for. -->
      <p
        v-else-if="hasEnteredOwnScores"
        role="status"
        class="text-muted-foreground py-2 text-center text-sm"
      >
        {{ t('room.online.waitingForHost') }}
      </p>
    </template>
  </main>
</template>
