import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import AddPlayerCard from './AddPlayerCard.vue'
import { i18n } from '@/i18n'
import { LocalGameRepository } from '@/lib/local-repository'
import type { KeyValueStorage } from '@/lib/local-repository'
import { useGameStore } from '@/stores/game'

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

/** A local game hosted by "Juho", with the card on screen. `onAdded` hears its `added` event. */
async function renderInGame(onAdded: (name: string) => void = () => undefined) {
  const repository = new LocalGameRepository({ storage: memoryStorage() })
  await useGameStore().start(repository, { hostDeviceUuid: 'device-host', hostDisplayName: 'Juho' })
  return render(AddPlayerCard, { props: { onAdded }, global: { plugins: [i18n] } })
}

async function openAndType(name: string): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'Add player' }))
  await fireEvent.update(screen.getByLabelText("Player's name"), name)
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('AddPlayerCard', () => {
  it('adds a player by name, closes and says who was added', async () => {
    const added: string[] = []
    await renderInGame((name) => added.push(name))

    await openAndType(' Mummo ')
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await flushPromises()

    expect(added).toEqual(['Mummo'])
    expect(useGameStore().standings.map(({ player }) => player.name)).toContain('Mummo')
    expect(screen.queryByLabelText("Player's name")).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add player' }))
  })

  it('asks for a name when the field is empty', async () => {
    await renderInGame()

    await openAndType('  ')
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('alert').textContent).toBe("Enter the player's name.")
  })

  it('says so when the name is already in the game', async () => {
    await renderInGame()

    await openAndType('JUHO')
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await flushPromises()

    expect(screen.getByRole('alert').textContent).toContain('already uses that name')
    expect((screen.getByLabelText("Player's name") as HTMLInputElement).value).toBe('JUHO')
  })

  it('closes on Cancel without adding anyone, handing focus back to its button', async () => {
    await renderInGame()

    await openAndType('Mummo')
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await flushPromises()

    expect(useGameStore().standings).toHaveLength(1)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add player' }))
  })

  it("explains it's for players without a phone only in an online game", async () => {
    await renderInGame()

    await fireEvent.click(screen.getByRole('button', { name: 'Add player' }))

    expect(screen.queryByText(/without a phone/)).toBeNull()
  })
})
