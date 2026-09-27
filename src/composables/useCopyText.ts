/**
 * Copies text on a tap: the Clipboard API first, then a hidden textarea where it's missing or
 * refused (an older iOS, a non-secure address). `copied` holds the text just copied for a moment,
 * so the caller can say "copied" and tell which thing was copied. Not VueUse's useClipboard: it
 * only uses the Clipboard API after a permission query Firefox and Safari don't support.
 */
import { onScopeDispose, ref } from 'vue'

const FEEDBACK_MS = 2000

function copyWithTextarea(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const isCopied = document.execCommand('copy')
  textarea.remove()
  return isCopied
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return copyWithTextarea(text)
  }
}

export function useCopyText() {
  const copied = ref<string | null>(null)
  let clearFeedback: ReturnType<typeof setTimeout> | undefined

  async function copy(text: string): Promise<void> {
    if (!(await writeToClipboard(text))) return
    copied.value = text
    clearTimeout(clearFeedback)
    clearFeedback = setTimeout(() => {
      copied.value = null
    }, FEEDBACK_MS)
  }

  onScopeDispose(() => clearTimeout(clearFeedback))

  return { copy, copied }
}
