import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/vue'
import HeadToHeadList from './HeadToHeadList.vue'
import { i18n } from '@/i18n'
import type { OpponentRecord } from '@/stores/stats'

function renderList(opponents: OpponentRecord[], claimedPlayerIds?: ReadonlySet<string>) {
  return render(HeadToHeadList, {
    props: { opponents, claimedPlayerIds },
    global: { plugins: [i18n] },
  })
}

function opponent(opponentDeviceUuid: string, displayName: string): OpponentRecord {
  return {
    opponentDeviceUuid,
    displayName,
    record: {
      deviceUuid: 'uid-me',
      opponentDeviceUuid,
      gamesPlayed: 1,
      wins: 1,
      losses: 0,
      ties: 0,
    },
  }
}

describe('HeadToHeadList', () => {
  it('shows a friendly empty message when there are no opponents yet', () => {
    renderList([])

    expect(screen.getByText('No shared games yet with other players.')).toBeTruthy()
  })

  it('shows each opponent’s displayName and their W-L-T record', () => {
    const opponents: OpponentRecord[] = [
      {
        opponentDeviceUuid: 'uid-bob',
        displayName: 'Bob',
        record: {
          deviceUuid: 'uid-me',
          opponentDeviceUuid: 'uid-bob',
          gamesPlayed: 3,
          wins: 2,
          losses: 1,
          ties: 0,
        },
      },
    ]

    renderList(opponents)

    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.getByText('2 W – 1 L – 0 T')).toBeTruthy()
  })

  it('lists multiple opponents, each with their own record', () => {
    const opponents: OpponentRecord[] = [
      {
        opponentDeviceUuid: 'uid-bob',
        displayName: 'Bob',
        record: {
          deviceUuid: 'uid-me',
          opponentDeviceUuid: 'uid-bob',
          gamesPlayed: 2,
          wins: 1,
          losses: 1,
          ties: 0,
        },
      },
      {
        opponentDeviceUuid: 'uid-carol',
        displayName: 'Carol',
        record: {
          deviceUuid: 'uid-me',
          opponentDeviceUuid: 'uid-carol',
          gamesPlayed: 1,
          wins: 0,
          losses: 0,
          ties: 1,
        },
      },
    ]

    renderList(opponents)

    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.getByText('Carol')).toBeTruthy()
    expect(screen.getByText('1 W – 1 L – 0 T')).toBeTruthy()
    expect(screen.getByText('0 W – 0 L – 1 T')).toBeTruthy()
  })

  it('badges an opponent who goes by the name they claimed', () => {
    renderList([opponent('uid-juho', 'Juho'), opponent('uid-other', 'Mari')], new Set(['uid-juho']))

    const [, juho, mari] = screen.getAllByRole('row')
    expect(juho?.textContent).toContain('Claimed name')
    expect(mari?.textContent).not.toContain('Claimed name')
  })
})
