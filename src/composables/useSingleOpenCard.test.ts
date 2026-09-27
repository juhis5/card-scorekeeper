import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, useTemplateRef, type Ref } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'
import { provideOpenCard, useSingleOpenCard } from './useSingleOpenCard'

interface Card {
  isOpen: Ref<boolean>
  onDismiss: ReturnType<typeof vi.fn>
}

function card(id: string, cards: Record<string, Card>) {
  return defineComponent({
    setup() {
      const isOpen = ref(false)
      const onDismiss = vi.fn(() => {
        isOpen.value = false
      })
      cards[id] = { isOpen, onDismiss }
      const element = useTemplateRef<HTMLElement>('card')
      useSingleOpenCard({ id: () => id, element, isOpen, onDismiss })
      return () => h('div', { ref: 'card' }, [h('button', `inside ${id}`)])
    },
  })
}

function renderRoom() {
  const cards: Record<string, Card> = {}
  const [first, second] = [card('first', cards), card('second', cards)]
  render(
    defineComponent({
      setup() {
        provideOpenCard()
        return () =>
          h('main', [
            h(first),
            h(second),
            h('button', 'Next round'),
            h('div', { role: 'dialog' }, [h('button', 'in a dialog')]),
          ])
      },
    }),
  )
  return cards as Record<'first' | 'second', Card>
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useSingleOpenCard', () => {
  it('dismisses the open card on a tap outside it, not on one inside it', async () => {
    const { first } = renderRoom()
    first.isOpen.value = true

    await fireEvent.pointerUp(screen.getByText('inside first'))
    expect(first.onDismiss).not.toHaveBeenCalled()

    await fireEvent.pointerUp(screen.getByText('Next round'))
    expect(first.onDismiss).toHaveBeenCalledTimes(1)
  })

  it('leaves the card open for a tap in a dialog it opened, such as the photo count', async () => {
    const { first } = renderRoom()
    first.isOpen.value = true

    await fireEvent.pointerUp(screen.getByText('in a dialog'))

    expect(first.onDismiss).not.toHaveBeenCalled()
  })

  it('dismisses the open card when another one opens, so one is open at a time', async () => {
    const { first, second } = renderRoom()
    first.isOpen.value = true
    await Promise.resolve()

    second.isOpen.value = true
    await Promise.resolve()

    expect(first.onDismiss).toHaveBeenCalledTimes(1)
    expect(second.onDismiss).not.toHaveBeenCalled()
  })

  it('does nothing for a closed card', async () => {
    const { first } = renderRoom()

    await fireEvent.pointerUp(screen.getByText('Next round'))

    expect(first.onDismiss).not.toHaveBeenCalled()
  })
})
