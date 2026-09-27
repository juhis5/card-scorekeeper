/**
 * Player names are unique within a game, compared without regard to case or extra spaces:
 * "Juho", "juho" and " Juho " are the same name, but "Mari Anne" and "Marianne" are not.
 *
 * `cleanPlayerName` is the form every name is stored in. `playerNameKey` is what uniqueness is
 * checked on, locally and online: an online seat is created together with a
 * `room/{code}/names/{key}` doc, and firestore.rules derives the same key from the stored name
 * ('n_' + lowercase, with '/' made safe for a document id), so the two must stay in step.
 *
 * Lowercasing is limited to what the rules can do: their lower() only changes A to Z, so the rules
 * fold the capitals in FOLDED_CAPITALS one by one and the key does exactly the same. Any other
 * capital is kept as typed, so "Ωmega" and "ωmega" count as two names.
 */

/** NFC so an accent typed two ways is one name; every whitespace run becomes one space. */
export function cleanPlayerName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim()
}

/** A to Z plus the Nordic capitals firestore.rules folds in nameKeyOf. Change both together. */
const FOLDED_CAPITALS = /[A-ZÄÖÅÜÉØÆ]/g

export function playerNameKey(name: string): string {
  const lowered = cleanPlayerName(name).replace(FOLDED_CAPITALS, (letter) => letter.toLowerCase())
  return `n_${lowered.replaceAll('/', '_')}`
}

export function isNameTaken(name: string, existingNames: readonly string[]): boolean {
  const key = playerNameKey(name)
  return existingNames.some((existing) => playerNameKey(existing) === key)
}

/** Indexes of the names that repeat an earlier one. Empty fields are skipped. */
export function duplicateNameIndexes(names: readonly string[]): Set<number> {
  const seen = new Set<string>()
  const duplicates = new Set<number>()
  names.forEach((name, index) => {
    if (cleanPlayerName(name) === '') return
    const key = playerNameKey(name)
    if (seen.has(key)) duplicates.add(index)
    seen.add(key)
  })
  return duplicates
}

/** Someone in this game already uses the name, compared as above. */
export class NameTakenError extends Error {
  readonly playerName: string

  constructor(playerName: string) {
    super(`Someone in this game already uses the name "${playerName}"`)
    this.name = 'NameTakenError'
    this.playerName = playerName
  }
}
