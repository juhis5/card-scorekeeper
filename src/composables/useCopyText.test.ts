import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useCopyText } from './useCopyText'

const FEEDBACK_MS = 2000

/** Runs `fn` in an effect scope, as a component's setup would, so `onScopeDispose` registers. */
function runInScope<T>(fn: () => T): { result: T; dispose: () => void } {
  const scope = effectScope()
  const result = scope.run(fn) as T
  return { result, dispose: () => scope.stop() }
}

function clipboardThatAccepts() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  return writeText
}

/** No Clipboard API (a non-secure address, older iOS): only the textarea fallback is left. */
function noClipboard(): void {
  vi.stubGlobal('navigator', {})
}

/** happy-dom has no `execCommand`: stands in for it, noting what the textarea held at the time. */
function stubExecCommand(isCopied: boolean) {
  const copiedFromTextarea: Array<string | undefined> = []
  document.execCommand = vi.fn(() => {
    copiedFromTextarea.push(document.querySelector('textarea')?.value)
    return isCopied
  })
  return copiedFromTextarea
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'execCommand')
})

describe('useCopyText, with the Clipboard API', () => {
  it('writes the text to the clipboard', async () => {
    const writeText = clipboardThatAccepts()
    const { result } = runInScope(() => useCopyText())

    await result.copy('7K4RQ')

    expect(writeText).toHaveBeenCalledWith('7K4RQ')
  })

  it('shows the copied text as feedback, then clears it after two seconds', async () => {
    clipboardThatAccepts()
    const { result } = runInScope(() => useCopyText())

    await result.copy('7K4RQ')
    expect(result.copied.value).toBe('7K4RQ')

    vi.advanceTimersByTime(FEEDBACK_MS)
    expect(result.copied.value).toBeNull()
  })

  it('restarts the feedback window when something else is copied meanwhile', async () => {
    clipboardThatAccepts()
    const { result } = runInScope(() => useCopyText())

    await result.copy('7K4RQ')
    vi.advanceTimersByTime(1500)
    await result.copy('https://rommi.vercel.app/join/7K4RQ')
    vi.advanceTimersByTime(1500)
    expect(result.copied.value).toBe('https://rommi.vercel.app/join/7K4RQ')

    vi.advanceTimersByTime(500)
    expect(result.copied.value).toBeNull()
  })

  it('drops the pending feedback timer once the owning scope is disposed', async () => {
    clipboardThatAccepts()
    const { result, dispose } = runInScope(() => useCopyText())
    await result.copy('7K4RQ')

    dispose()

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useCopyText, without the Clipboard API', () => {
  it('copies through a hidden textarea holding the text', async () => {
    noClipboard()
    const copiedFromTextarea = stubExecCommand(true)
    const { result } = runInScope(() => useCopyText())

    await result.copy('7K4RQ')

    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(copiedFromTextarea).toEqual(['7K4RQ'])
    expect(result.copied.value).toBe('7K4RQ')
  })

  it('removes the textarea again after copying', async () => {
    noClipboard()
    stubExecCommand(true)
    const { result } = runInScope(() => useCopyText())

    await result.copy('7K4RQ')

    expect(document.querySelector('textarea')).toBeNull()
  })

  it('shows no feedback when the browser refuses the copy', async () => {
    noClipboard()
    stubExecCommand(false)
    const { result } = runInScope(() => useCopyText())

    await result.copy('7K4RQ')

    expect(result.copied.value).toBeNull()
  })
})
