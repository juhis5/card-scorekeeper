/**
 * The theme: classes on `<html>` and a plain string in localStorage under `theme`, which
 * index.html's no-flash script reads the same way. Not a persisted Pinia store: that would
 * JSON-wrap the value.
 */
import { ref } from 'vue'
import { isDarkTheme, paletteClass, parseTheme, THEMES, type Theme } from '@/lib/platform/themes'

const THEME_STORAGE_KEY = 'theme'

function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('dark', isDarkTheme(theme))
  for (const other of THEMES) root.classList.remove(`theme-${other}`)
  const palette = paletteClass(theme)
  if (palette) root.classList.add(palette)
  // The phone's status bar and the installed app's title bar follow the page's background.
  const background = getComputedStyle(root).getPropertyValue('--background').trim()
  if (background)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background)
}

function storedTheme(): Theme {
  return parseTheme(localStorage.getItem(THEME_STORAGE_KEY))
}

/** At startup: the no-flash script already set the classes; this also sets the theme color. */
export function applyStoredTheme(): void {
  applyTheme(storedTheme())
}

export function useTheme() {
  const theme = ref<Theme>(storedTheme())
  applyTheme(theme.value)

  function setTheme(value: Theme): void {
    theme.value = value
    applyTheme(value)
    localStorage.setItem(THEME_STORAGE_KEY, value)
  }

  return { theme, setTheme }
}
