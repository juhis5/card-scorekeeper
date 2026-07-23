---
name: design-system
description: The visual design system — CSS-variable design tokens (color, type, space, radius, motion), dark-first theming with a light option, and component styling conventions. Read before writing any CSS, styling a component, choosing a color, or building the theme toggle. This is the look layer; a11y-mobile is the access layer — use both.
---

# Design system — dark-first, token-driven

One system, applied consistently. **Never hardcode a color, size, or radius in a component** — use a token. Dark is the default and the identity; light is supported.

## Tokens (CSS custom properties)

Define once, globally (e.g. `src/assets/tokens.css`). Components read `var(--…)` only.

```css
:root {
  --font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --text-xs: 0.75rem;  --text-sm: 0.875rem; --text-base: 1rem;
  --text-lg: 1.25rem;  --text-xl: 1.5rem;   --text-2xl: 2rem;
  --weight-regular: 400; --weight-medium: 500; --weight-semibold: 600; --weight-bold: 700;
  --leading-tight: 1.2; --leading-normal: 1.5;

  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem;
  --space-5: 1.5rem;  --space-6: 2rem;   --space-8: 3rem;

  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-full: 9999px;
  --dur-fast: 120ms; --dur: 200ms; --ease: cubic-bezier(0.2, 0, 0.2, 1);
}

/* DARK is the default palette */
:root, :root[data-theme='dark'] {
  --bg: #0b0f14;          /* near-black slate, NOT pure #000 */
  --surface: #131a22;
  --surface-2: #1b232d;   /* elevated */
  --border: #263140;
  --text: #e6edf3;        /* softened white */
  --text-muted: #9aa7b4;
  --primary: #34d399;     /* card-table emerald */
  --primary-contrast: #04140d;
  --danger: #f87171; --success: #34d399; --warning: #fbbf24;
  --focus: var(--primary);
  --shadow-1: 0 1px 2px rgba(0,0,0,0.4);
}

/* LIGHT — opt-in via toggle, or system when no stored pref */
:root[data-theme='light'] {
  --bg: #f7f9fb; --surface: #ffffff; --surface-2: #eef2f6; --border: #d5dde5;
  --text: #0b0f14; --text-muted: #566573;
  --primary: #059669; --primary-contrast: #ffffff;
  --danger: #dc2626; --success: #059669; --warning: #b45309;
  --focus: var(--primary); --shadow-1: 0 1px 3px rgba(16,24,40,0.1);
}
```

Treat the hex values as a **starting palette** — tune them, keep the token *names* stable. Every pair must pass the contrast bar in `a11y-mobile` (≥ 4.5:1 text) in **both** themes.

## Theming behavior

- **Default is dark.** On load, `data-theme` = stored preference, else `'dark'`. A persisted manual toggle (dark ↔ light) always wins; optionally a "system" choice reads `prefers-color-scheme`.
- Persist (localStorage / `pinia-plugin-persistedstate`), key `theme` — the same identity store that holds the device UUID + display name is a natural home.
- **No flash:** set `data-theme` in an inline `<head>` script before paint:
  ```html
  <script>document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark'</script>
  ```
- A `useTheme()` composable owns the toggle; the toggle is a real labelled `<button>` (see `a11y-mobile`).

## Dark-mode specifics (get these right)

- Not pure black bg, not pure white text.
- **Elevation = a lighter surface, not a heavier shadow.** Lift cards/sheets/the scoreboard with `--surface-2` + `--border`, not big shadows.
- Slightly desaturate accents in dark so they don't vibrate.

## Component conventions

- **Buttons:** primary (`--primary`/`--primary-contrast`), secondary (surface+border), ghost, danger. Min 44px, `--radius-md`. Full-width primary action on mobile (enter score, next round).
- **Inputs:** the score input is numeric and big (thumb-friendly); `--surface-2` bg, `--border`, `--focus` ring, label above.
- **Surfaces/cards:** `--surface`, `--border`, `--radius-lg`, `--space-4`.
- **Sheets/dialogs:** bottom sheet over center modal on mobile; focus-trapped; safe-area padded.
- **Bottom action bar:** primary actions pinned bottom (thumb zone), `padding-bottom: env(safe-area-inset-bottom)`.
- **Toasts/banners:** from `--success`/`--danger`/`--warning` + surface. The **offline banner** (see `error-ux`) uses `--warning` — persistent, readable, with text + icon (not color alone).

## Consistency rules

- No raw hex, no magic px in components — tokens only; add a token if one's missing.
- Spacing/type from the scales. Honor `prefers-reduced-motion` for all transitions.

## Charts (stats screens)

The stats/head-to-head screens use the built-in **`dataviz`** skill. Feed it these tokens so charts match the app: dark-first, `--primary` as the key series, `--text-muted` for axes/gridlines, and never rely on color alone for series identity (label or pattern too — same rule as `a11y-mobile`).

## This project (card-scorekeeper)

Accent is a card-table **emerald**. Key surfaces: the **scoreboard** (sorted ascending, leader row lifted with `--surface-2` + a text/icon marker, not just color; live score changes get a brief `--dur-fast` highlight gated by reduced-motion), the round/contract banner, the join screen, and the offline banner. A win celebration is fine but must respect `prefers-reduced-motion`.
