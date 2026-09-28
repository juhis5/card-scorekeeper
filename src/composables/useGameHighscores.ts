/**
 * The public game lists this finished online game made, live: the host publishes the entries just
 * after the finish, so every phone sees them appear. Only when `gameId` names a finished online
 * game; Firebase loads only then.
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue'
import {
  GAME_LIST_FIELDS,
  highscoresOfGame,
  type GameHighscore,
  type GameListName,
  type ListDoc,
} from '@/lib/game/highscores'
import { reportHandledError } from '@/lib/platform/error-reporting'
import { HIGHSCORE_LIMIT, HIGHSCORE_LISTS } from '@/stores/highscores'

type Unsubscribe = () => void

export function useGameHighscores(gameId: () => string | null): Ref<GameHighscore[]> {
  const highscores = ref<GameHighscore[]>([])
  let unsubscribes: Unsubscribe[] = []
  /** Bumped on every change and on dispose: a setup that finishes late then stops at once. */
  let generation = 0

  function stop(): void {
    generation += 1
    unsubscribes.forEach((unsubscribe) => unsubscribe())
    unsubscribes = []
  }

  async function follow(id: string, started: number): Promise<void> {
    const [{ getDb, ensureSignedIn }, { watchTop }] = await Promise.all([
      import('@/lib/data/firebase'),
      import('@/lib/data/stats-reads'),
    ])
    await ensureSignedIn()
    if (started !== generation) return
    const db = getDb()
    const lists: Record<GameListName, ListDoc[]> = {
      bestGames: [],
      worstGames: [],
      biggestRounds: [],
    }
    unsubscribes = (Object.keys(GAME_LIST_FIELDS) as GameListName[]).map((name) =>
      watchTop(db, HIGHSCORE_LISTS[name], HIGHSCORE_LIMIT, (docs) => {
        lists[name] = docs
        highscores.value = highscoresOfGame(id, lists)
      }),
    )
  }

  watch(
    gameId,
    (id) => {
      stop()
      highscores.value = []
      // An extra: if Firebase can't be reached, the finish screen just doesn't show it.
      if (id)
        follow(id, generation).catch((error: unknown) =>
          reportHandledError(error, 'game-highscores'),
        )
    },
    { immediate: true },
  )
  onScopeDispose(stop)

  return highscores
}
