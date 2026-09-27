/**
 * Copies on a tap: the Clipboard API, else a hidden textarea (older iOS, a non-secure address).
 * `copied` briefly holds the copied text. Not VueUse's useClipboard: it first runs a permission
 * query that Firefox and Safari don't support.
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
