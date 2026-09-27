/**
 * One card open at a time in a room, and a tap outside the open card closes it.
 * A tap is a `pointerup`: a scroll ends in `pointercancel` instead, so scrolling never closes a
 * card. Taps in a dialog or on its overlay (the photo count, the remove confirm) don't count.
 */
import { inject, provide, ref, watch, type InjectionKey, type Ref } from 'vue'
import { useEventListener } from '@vueuse/core'

const OPEN_CARD: InjectionKey<Ref<string | null>> = Symbol('open-card')
const IN_DIALOG = '[role="dialog"], [role="alertdialog"], [data-slot$="-overlay"]'

/** The room says which of its cards is open. */
export function provideOpenCard(): void {
  provide(OPEN_CARD, ref<string | null>(null))
}

export function useSingleOpenCard({
  id,
  element,
  isOpen,
  onDismiss,
}: {
  id: () => string
  element: Readonly<Ref<HTMLElement | null>>
  isOpen: Readonly<Ref<boolean>>
  onDismiss: () => void
}): void {
  const openCard = inject(OPEN_CARD, null)

  if (openCard) {
    watch(isOpen, (open) => {
      if (open) openCard.value = id()
      else if (openCard.value === id()) openCard.value = null
    })
    watch(openCard, (current) => {
      if (isOpen.value && current !== id()) onDismiss()
    })
  }

  useEventListener(document, 'pointerup', (event) => {
    if (!isOpen.value || !(event.target instanceof Element)) return
    if (element.value?.contains(event.target) || event.target.closest(IN_DIALOG)) return
    onDismiss()
  })
}
