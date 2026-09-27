/**
 * Player names are unique within a game, compared without regard to case or extra spaces:
 * "Juho", "juho" and " Juho " are the same name, but "Mari Anne" and "Marianne" are not.
 *
 * `cleanPlayerName` is the form every name is stored in. `playerNameKey` is what uniqueness is
 * checked on, locally and online: an online seat is created together with a
 * `room/{code}/names/{key}` doc, and firestore.rules derives the same key from the stored name
 * ('n_' + lower, with '/' made safe for a document id), so the two must stay in step.
 */

/** NFC so an accent typed two ways is one name; every whitespace run becomes one space. */
export function cleanPlayerName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function playerNameKey(name: string): string {
  return `n_${cleanPlayerName(name).toLowerCase().replaceAll('/', '_')}`
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
