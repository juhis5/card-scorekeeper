---
name: design-system
description: The visual design system — Tailwind v4 + shadcn-vue theme tokens (CSS variables), the eight named themes (Kapteeni default), and styling conventions. Read before writing any styles, choosing a color, tuning or adding a theme, or touching the theme picker. This is the look layer; a11y-mobile is the access layer; component-library is the parts. Use all three.
---

# Design system — named themes, Tailwind v4 + shadcn tokens

Styling engine is **Tailwind v4**; the palettes live in **shadcn-vue's CSS-variable theme** (`:root`, `.dark` and one `.theme-<id>` block per named palette), consumed through **semantic Tailwind classes**. **Never hardcode a color or arbitrary size in a component** — use a token class, so every theme works.

## Where tokens live

All tokens are in `src/assets/main.css`. The shadcn scaffolding looks like this (abridged; the real file has more tokens, e.g. `--brand` for the app name and the leader's crown):

```css
@import 'tailwindcss';
@custom-variant dark (&:is(.dark *));

:root {              /* LIGHT values */
  --background: #f7f9fb; --foreground: #0b0f14;
  --card: #ffffff; --card-foreground: #0b0f14;
  --muted: #eef2f6; --muted-foreground: #566573;
  --primary: #047857; --primary-foreground: #ffffff;   /* card-table emerald (700: AA as text) */
  --destructive: #dc2626; --border: #d5dde5; --input: #d5dde5; --ring: #047857;
  --radius: 0.625rem;
}
.dark {              /* DARK values — the primary craft target */
  --background: #0b0f14; --foreground: #e6edf3;         /* not #000 / not #fff */
  --card: #131a22; --card-foreground: #e6edf3;
  --muted: #1b232d; --muted-foreground: #9aa7b4;
  --primary: #34d399; --primary-foreground: #04140d;    /* accent desaturated for dark */
  --destructive: #f87171; --border: #263140; --input: #263140; --ring: #34d399;
}
@theme inline {      /* maps CSS vars -> Tailwind color tokens (bg-background, etc.) */
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-card: var(--card); --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-destructive: var(--destructive); --color-border: var(--border); --color-ring: var(--ring);
}

/* Motion — shared across themes */
:root { --dur-fast: 120ms; --dur: 200ms; }
@theme { --ease-standard: cubic-bezier(0.2, 0, 0.2, 1); }   /* generates the `ease-standard` utility */
```

Values are hex (the contrast test parses hex). Keep the token names. Every text pair the app uses passes the `a11y-mobile` contrast bar (≥ 4.5:1 text, ≥ 3:1 focus ring at `ring/80`) in **every** theme. `src/assets/theme-contrast.test.ts` reads `main.css` and enforces it; add a pair there when a token lands on a new surface.

## Token map (nothing was lost adopting Tailwind)

Colors weren't dropped — they were renamed to shadcn's semantic tokens; scales became Tailwind's built-in ones:

| Earlier hand-rolled draft | Now (shadcn token → utility) |
|---|---|
| `--bg` | `--background` → `bg-background` |
| `--surface` | `--card` → `bg-card` |
| `--surface-2` (elevated) | `--muted` → `bg-muted` |
| `--text` | `--foreground` → `text-foreground` |
| `--text-muted` | `--muted-foreground` → `text-muted-foreground` |
| `--primary` / `--primary-contrast` | `--primary` / `--primary-foreground` |
| `--border` / `--focus` | `--border` / `--ring` |
| `--danger` | `--destructive` |
| `--space-*`, `--text-*`, radius scales | Tailwind's built-in scale (`p-4`, `text-lg`, `rounded-lg`); custom values go in `@theme` |

Elevation is still three levels: `background` (base) → `card` → `muted`.

## Motion tokens

Named motion lives in the CSS block above:
- **Easing:** `--ease-standard` is registered in `@theme`, so use the `ease-standard` utility.
- **Duration:** `--dur-fast` / `--dur` are plain vars (Tailwind has no named-duration utility) — use `duration-[var(--dur)]`, or Tailwind's numeric `duration-200`.
- Gate non-essential motion so it respects `prefers-reduced-motion` (see `a11y-mobile`), e.g. the live score-change highlight → `class="transition-colors duration-[var(--dur)] ease-standard motion-reduce:transition-none"`.

## Themes

- **Eight themes**, listed in `src/lib/platform/themes.ts` (`THEMES`): `captain` (Kapteeni, **`DEFAULT_THEME`**), `captain-light`, `dark` / `light` (Vihreä, the original emerald), `jani`, `nord`, `dracula`, `solarized`. `isDarkTheme()` knows which are dark.
- **Classes on `<html>`:** a dark theme also carries `.dark`, so Tailwind's `dark:` variant applies. `paletteClass()` gives `theme-<id>` for the named palettes; `dark` and `light` have none and use the `.dark` / `:root` blocks. (`.theme-light` exists only so the picker's swatch can show light tokens on a dark page.) Named palettes come after `.dark` in `main.css` so they win.
- **No flash:** an inline script in `index.html` `<head>` reads `localStorage.theme` (in try/catch), falls back to `captain`, and sets the classes before paint. It repeats the theme lists, and a test keeps them equal to `themes.ts`; its hash is in `vercel.json`'s CSP and `src/security-headers.test.ts` checks it, so editing the script means updating the hash.
- **`useTheme()`** (`src/composables/useTheme.ts`) applies the classes, stores the id as a raw string under `theme` via `browserLocalStorage()` (not persistedstate, which would JSON-wrap it and break the script), and sets `<meta name="theme-color">` from `--background`.
- **Picker:** `ThemePicker.vue` in the menu, a `RadioGroup` with a swatch per theme (see `component-library`).
- **Adding a theme:** a `.theme-<id>` block in `main.css`, the id in `THEMES` (and `LIGHT_THEMES` if light), the same in `index.html`'s script, a name under `app.theme.names` in both locales, and a row in `src/assets/theme-contrast.test.ts`'s list (it doesn't read `THEMES`), then a new CSP hash in `vercel.json`.

## Styling conventions

- **Semantic classes**: `bg-background text-foreground`, `bg-card`, `bg-muted text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`, `ring-ring`, `rounded-[var(--radius)]`.
- **No arbitrary values** (`mt-[13px]`, `text-[#abc]`) — use the scale + tokens; add a token if one's missing.
- `prettier-plugin-tailwindcss` sorts classes automatically (see `clean-code`).

## Dark-mode specifics (get these right)

- Not pure black bg, not pure white text.
- **Elevation = a lighter surface, not a heavier shadow.** Lift the scoreboard/cards/sheets with `bg-card` / `bg-muted` + `border-border`.
- Desaturate accents in dark palettes.

## Consistency rules

- Tokens/scale only — no raw hex, no magic px, in components.
- Honor `prefers-reduced-motion` (score-change flashes, win celebration).
- Both apps share this token structure → same feel; only the palettes differ.

## Charts (stats screens)

Stats/head-to-head use the built-in **`dataviz`** skill. Feed it these tokens (they must work in every theme): `--primary` as the key series, `--muted-foreground` for axes/gridlines, and never rely on color alone for series identity (label/pattern too — same rule as `a11y-mobile`).

## This project (card-scorekeeper)

The default Kapteeni palette matches the app icon: brown-black, gold `--primary` actions, label-red `--brand` (danger is a separate coral, always with an icon or words). Key surfaces: the **scoreboard `Table`** (sorted ascending, leader row lifted with `bg-muted` + a text/icon marker not just color; live changes get a brief highlight gated by reduced-motion); the round/contract banner; the join screen; the local-game badge in the header (`LocalGameBadge`: no-wifi icon + popover text, announced per `a11y-mobile`). A win celebration is fine but must respect `prefers-reduced-motion`.
