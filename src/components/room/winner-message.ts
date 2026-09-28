/** "Alice wins!" or "Alice and Bob share the win!", shared by the banner and the announcement. */
import type { Composer } from 'vue-i18n'
import type { Standing } from '@/lib/game/types'

export function winnerMessage(
  { t, locale }: Pick<Composer, 't' | 'locale'>,
  winners: readonly Standing[],
): string {
  // Intl gives the locale's own "Alice, Bob and Carol" / "Alice, Bob ja Carol".
  const names = new Intl.ListFormat(locale.value, { style: 'long', type: 'conjunction' }).format(
    winners.map((standing) => standing.player.name),
  )
  return winners.length > 1
    ? t('room.winner.tie', { names })
    : t('room.winner.single', { name: names })
}
