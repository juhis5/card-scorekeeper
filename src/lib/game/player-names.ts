/**
 * Names are unique per game, ignoring case and extra spaces. Online, each seat comes with a
 * `room/{code}/names/{key}` doc whose key firestore.rules derives from the stored name, so
 * `playerNameKey` must stay in step with the rules.
 */

/** NFC so an accent typed two ways is one name; every whitespace run becomes one space. */
export function cleanPlayerName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim()
}

/** A to Z plus the capitals the rules' nameKeyOf folds one by one, as their lower() only does A to
 * Z. Change both together. Any other capital stays as typed. */
const FOLDED_CAPITALS = /[A-ZÄÖÅÜÉØÆ]/g

export function playerNameKey(name: string): string {
  const lowered = cleanPlayerName(name).replace(FOLDED_CAPITALS, (letter) => letter.toLowerCase())
  return `n_${lowered.replaceAll('/', '_')}`
}

export function isNameTaken(name: string, existingNames: readonly string[]): boolean {
  const key = playerNameKey(name)
  return existingNames.some((existing) => playerNameKey(existing) === key)
}

/** `isGuestSeat` when the name belongs to a host-added guest, so a joiner can be told to ask the
 * host. */
export class NameTakenError extends Error {
  readonly playerName: string
  readonly isGuestSeat: boolean

  constructor(playerName: string, { isGuestSeat = false }: { isGuestSeat?: boolean } = {}) {
    super(`Someone in this game already uses the name "${playerName}"`)
    this.name = 'NameTakenError'
    this.playerName = playerName
    this.isGuestSeat = isGuestSeat
  }
}
