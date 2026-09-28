/** Palettes live in src/assets/main.css. index.html's no-flash script repeats these lists, since it
 * runs before any module loads; a test keeps them the same. */
export const THEMES = [
  'captain',
  'captain-light',
  'dark',
  'light',
  'jani',
  'nord',
  'dracula',
  'solarized',
] as const
export type Theme = (typeof THEMES)[number]

/** Kapteeni, matching the app icon. The first emerald themes are kept as Vihreä. */
export const DEFAULT_THEME: Theme = 'captain'

const LIGHT_THEMES: ReadonlySet<Theme> = new Set(['captain-light', 'light', 'solarized'])

export function parseTheme(stored: string | null): Theme {
  return THEMES.find((theme) => theme === stored) ?? DEFAULT_THEME
}

/** Dark themes also carry the `dark` class, so Tailwind's `dark:` styles apply to them. */
export function isDarkTheme(theme: Theme): boolean {
  return !LIGHT_THEMES.has(theme)
}

export function paletteClass(theme: Theme): string | null {
  return theme === 'dark' || theme === 'light' ? null : `theme-${theme}`
}
