/**
 * Theme state: toggles the `.dark` class on `<html>` and persists the choice to `localStorage`
 * under the `theme` key — the SAME key and fallback formula as the no-flash inline script in
 * `index.html` (`(localStorage.getItem('theme') ?? 'dark') === 'dark'`), so the toggle can never
 * disagree with the page's initial paint. Dark is the default when nothing is stored (see the
 * design-system skill).
 *
 * Deliberately NOT a module-level singleton and NOT stored in the identity Pinia store:
 * - A single `ThemeToggle` is the only consumer (see App.vue), so there's no cross-component sync
 *   to solve — module-level mutable state would only add a documented flaky-test risk (tdd skill)
 *   for no benefit.
 * - `pinia-plugin-persistedstate` JSON-wraps a store's state under its own key; persisting theme
 *   there would stop matching the raw string the no-flash script reads, reintroducing the flash
 *   this composable exists to avoid.
 */
import { ref } from 'vue'

export type Theme = 'dark' | 'light'

const THEME_STORAGE_KEY = 'theme'

/** Mirrors `index.html`'s inline no-flash script exactly: only a missing key defaults to dark —
 * any other stored value (including something unexpected) is treated as light, same as the script. */
function readStoredTheme(): Theme {
  return (localStorage.getItem(THEME_STORAGE_KEY) ?? 'dark') === 'dark' ? 'dark' : 'light'
}

function applyTheme(value: Theme): void {
  document.documentElement.classList.toggle('dark', value === 'dark')
}

export function useTheme() {
  const theme = ref<Theme>(readStoredTheme())
  // Re-apply on creation: idempotent when the no-flash script already set the class, and makes
  // this composable correct standalone (e.g. a component test that mounts ThemeToggle without
  // executing index.html's inline script).
  applyTheme(theme.value)

  function setTheme(value: Theme): void {
    theme.value = value
    applyTheme(value)
    localStorage.setItem(THEME_STORAGE_KEY, value)
  }

  function toggleTheme(): void {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  return { theme, setTheme, toggleTheme }
}
