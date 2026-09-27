/**
 * The color themes (fourth round). Dark is the default and the app's identity; each palette lives
 * in src/assets/main.css. index.html's no-flash script repeats these lists (a test keeps them the
 * same), because it runs before any module loads.
 */
export const THEMES = ['dark', 'light', 'jani', 'nord', 'dracula', 'solarized'] as const
export type Theme = (typeof THEMES)[number]

const LIGHT_THEMES: ReadonlySet<Theme> = new Set(['light', 'solarized'])

/** What localStorage holds; nothing or an unknown value means the default. */
export function parseTheme(stored: string | null): Theme {
  return THEMES.find((theme) => theme === stored) ?? 'dark'
}

/** Dark themes also carry the `dark` class, so Tailwind's `dark:` styles apply to them. */
export function isDarkTheme(theme: Theme): boolean {
  return !LIGHT_THEMES.has(theme)
}

/** The class that swaps in a palette beyond plain dark and light. */
export function paletteClass(theme: Theme): string | null {
  return theme === 'dark' || theme === 'light' ? null : `theme-${theme}`
}
