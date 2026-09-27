import { describe, expect, it } from 'vitest'
import {
  cleanPlayerName,
  duplicateNameIndexes,
  isNameTaken,
  NameTakenError,
  playerNameKey,
} from './player-names'

describe('cleanPlayerName', () => {
  it('trims the ends and collapses extra spaces in between', () => {
    expect(cleanPlayerName('  Mari   Anne ')).toBe('Mari Anne')
  })

  it('treats tabs and non-breaking spaces like spaces', () => {
    expect(cleanPlayerName('Mari\tAnne ')).toBe('Mari Anne')
  })

  it('composes accents, so an ä typed two ways is the same name', () => {
    expect(cleanPlayerName('Mätti')).toBe('Mätti')
  })
})

describe('playerNameKey', () => {
  it('ignores case and extra spaces', () => {
    expect(playerNameKey(' Juho ')).toBe(playerNameKey('juho'))
    expect(playerNameKey('Mari  Anne')).toBe(playerNameKey('mari anne'))
  })

  it('keeps single spaces, so "Mari Anne" and "Marianne" are different names', () => {
    expect(playerNameKey('Mari Anne')).not.toBe(playerNameKey('Marianne'))
  })

  it('folds Finnish and other Nordic capitals, which the rules can match', () => {
    expect(playerNameKey('ÄIJÄLÄ Östman')).toBe(playerNameKey('äijälä östman'))
    expect(playerNameKey('Åsa Øberg Æsir Über Émile')).toBe(
      playerNameKey('åsa øberg æsir über émile'),
    )
  })

  it("leaves other non-ASCII capitals as typed, since the rules can't lowercase them", () => {
    expect(playerNameKey('Ωmega')).toBe('n_Ωmega')
  })

  it('matches the key firestore.rules derives from a stored name', () => {
    // firestore.rules: 'n_' + name.lower().replace('/', '_'), on the already cleaned name.
    expect(playerNameKey('Äijä/Pete')).toBe('n_äijä_pete')
  })
})

describe('isNameTaken', () => {
  it('finds a name already in use, ignoring case and spaces', () => {
    expect(isNameTaken(' JUHO', ['Ripa', 'Juho'])).toBe(true)
    expect(isNameTaken('Jani', ['Ripa', 'Juho'])).toBe(false)
  })
})

describe('duplicateNameIndexes', () => {
  it('marks every name that repeats an earlier one, and skips empty fields', () => {
    expect([...duplicateNameIndexes(['Juho', 'Ripa', ' juho', '', '', 'RIPA'])]).toEqual([2, 5])
  })
})

describe('NameTakenError', () => {
  it('carries the name that was taken', () => {
    const error = new NameTakenError('Juho')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('NameTakenError')
    expect(error.playerName).toBe('Juho')
  })
})
