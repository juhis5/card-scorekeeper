/** Ranking the public lists, and finding a finished game's places on them. */

/** One document of a public list, as read: its id and fields. */
export interface ListDoc {
  id: string
  data: Record<string, unknown>
}

/** The game records a finished game can make, and the field each is sorted on. */
export const GAME_LIST_FIELDS = {
  bestGames: 'finalScore',
  worstGames: 'finalScore',
  biggestRounds: 'worstRound',
} as const

export type GameListName = keyof typeof GAME_LIST_FIELDS

export interface GameHighscore {
  list: GameListName
  rank: number
  displayName: string
  value: number
}

/** In a sorted list, the rank at `index`: equal values share the rank of the first (1, 1, 3). */
export function rankAt(values: readonly unknown[], index: number): number {
  return values.indexOf(values[index]) + 1
}

/** Where this game's players stand on each game list. An entry's id is `{gameId}_{player}`. */
export function highscoresOfGame(
  gameId: string,
  lists: Record<GameListName, readonly ListDoc[]>,
): GameHighscore[] {
  return (Object.keys(GAME_LIST_FIELDS) as GameListName[]).flatMap((list) => {
    const docs = lists[list]
    const field = GAME_LIST_FIELDS[list]
    const values = docs.map((doc) => doc.data[field])
    return docs.flatMap((doc, index) =>
      doc.id.startsWith(`${gameId}_`)
        ? [
            {
              list,
              rank: rankAt(values, index),
              displayName: String(doc.data.displayName),
              value: Number(doc.data[field]),
            },
          ]
        : [],
    )
  })
}
