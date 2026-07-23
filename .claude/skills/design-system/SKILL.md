---
name: design-system
description: The visual design system — Tailwind v4 + shadcn-vue theme tokens (CSS variables), dark-first theming with a light option, and styling conventions. Read before writing any styles, choosing a color, tuning the theme, or building the theme toggle. This is the look layer; a11y-mobile is the access layer; component-library is the parts. Use all three.
---

# Design system — dark-first, Tailwind v4 + shadcn tokens

Styling engine is **Tailwind v4**; the palette lives in **shadcn-vue's CSS-variable theme** (`:root` + `.dark`), consumed through **semantic Tailwind classes**. **Never hardcode a color or arbitrary size in a component** — use a token class. Dark is the default and the identity; light is supported.

## Where tokens live

`shadcn-vue init` generates the theme (in `src/assets/index.css` or similar):

```css
@import 'tailwindcss';
@custom-variant dark (&:is(.dark *));

:root {              /* LIGHT values */
  --background: #f7f9fb; --foreground: #0b0f14;
  --card: #ffffff; --card-foreground: #0b0f14;
  --muted: #eef2f6; --muted-foreground: #566573;
  --primary: #059669; --primary-foreground: #ffffff;   /* card-table emerald */
  --destructive: #dc2626; --border: #d5dde5; --input: #d5dde5; --ring: #059669;
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

The CLI writes this scaffolding (v4 uses **oklch** by default — hex or oklch both fine). Our job: **set the values dark-first, keep the token names.** Every pair passes the `a11y-mobile` contrast bar (≥ 4.5:1 text) in **both** themes.

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

## Theming behavior (dark default)

- shadcn convention: `:root` = light, `.dark` = dark. We make **dark the default by adding the `.dark` class** unless the user chose light.
- **No flash** — inline script in `index.html` `<head>` before paint:
  ```html
  <script>document.documentElement.classList.toggle('dark',(localStorage.getItem('theme')??'dark')==='dark')</script>
  ```
- A `useTheme()` composable toggles the `.dark` class + persists (`localStorage` / `pinia-plugin-persistedstate`, key `theme`) — the identity store that holds the device UUID + display name is a natural home. Toggle is a labelled `Switch` (see `component-library`, `a11y-mobile`).

## Styling conventions

- **Semantic classes**: `bg-background text-foreground`, `bg-card`, `bg-muted text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`, `ring-ring`, `rounded-[var(--radius)]`.
- **No arbitrary values** (`mt-[13px]`, `text-[#abc]`) — use the scale + tokens; add a token if one's missing.
- `prettier-plugin-tailwindcss` sorts classes automatically (see `clean-code`).

## Dark-mode specifics (get these right)

- Not pure black bg, not pure white text.
- **Elevation = a lighter surface, not a heavier shadow.** Lift the scoreboard/cards/sheets with `bg-card` / `bg-muted` + `border-border`.
- Desaturate accents in the `.dark` block.

## Consistency rules

- Tokens/scale only — no raw hex, no magic px, in components.
- Honor `prefers-reduced-motion` (score-change flashes, win celebration).
- Both apps share this token structure → same feel; only `--primary` differs.

## Charts (stats screens)

Stats/head-to-head use the built-in **`dataviz`** skill. Feed it these tokens: dark-first, `--primary` as the key series, `--muted-foreground` for axes/gridlines, and never rely on color alone for series identity (label/pattern too — same rule as `a11y-mobile`).

## This project (card-scorekeeper)

Accent `--primary` is a card-table **emerald**. Key surfaces: the **scoreboard `Table`** (sorted ascending, leader row lifted with `bg-muted` + a text/icon marker not just color; live changes get a brief highlight gated by reduced-motion); the round/contract banner; the join screen; the offline banner (custom, `bg-muted`/warning tint, text + icon, announced per `a11y-mobile`). A win celebration is fine but must respect `prefers-reduced-motion`.
