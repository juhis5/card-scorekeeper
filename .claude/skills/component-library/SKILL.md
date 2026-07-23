---
name: component-library
description: How to use shadcn-vue (Reka UI + Tailwind v4) as the component library — setup, adding components, when to use a library component vs build custom, and keeping a11y intact. Read before building any UI element that has a common primitive (dialog, sheet, toast, select, switch, tabs, table, tooltip, dropdown).
---

# Component library — shadcn-vue (Reka UI + Tailwind v4)

Don't reinvent primitives. shadcn-vue gives **copy-in components you own**, built on **Reka UI** (accessible headless behavior — focus traps, keyboard, ARIA) and styled with **Tailwind v4** + our design tokens. The a11y-hard parts come for free; you keep full control of the code.

## Setup (once, by the scaffolding agent)

After `create-vue` + Tailwind v4 are in place:

```bash
pnpm dlx shadcn-vue@latest init          # sets components.json, lib/utils.ts (cn), the CSS theme
pnpm dlx shadcn-vue@latest add button dialog sheet input label sonner table
```

- Verify the current commands/flags against shadcn-vue docs — versions here are directional ("use latest").
- Components land in `src/components/ui/`. The `cn()` helper (clsx + tailwind-merge) lives in `src/lib/utils.ts`.
- The theme (CSS variables in `:root` + `.dark`) is set here — see the `design-system` skill for our dark-first values.

## The rule: reach for a primitive first

Before hand-building anything, check if it's a solved primitive. Add it, don't rebuild it:

| Need | shadcn-vue component |
|------|----------------------|
| Confirm / destructive action (remove player, end game) | `AlertDialog` |
| Bottom sheet on mobile | `Sheet` (side="bottom") — prefer over `Dialog` on phones |
| Toasts (see `error-ux`) | `Sonner` (or `Toast`) |
| Theme toggle (see `design-system`) | `Switch` or `Button` |
| The scoreboard | `Table` |
| Round navigation (1→5) | `Tabs` / stepper |
| Field + validation (room code, score) | `Input` + `Label` + form field |
| Confirm photo-count result | `Dialog` / `Sheet` with the card list |

## Custom components compose primitives

- Domain components (`ScoreBoard.vue`, `ContractBanner.vue`, `PlayerRow.vue`) **compose** `ui/*` primitives; they don't re-implement table/dialog/select behavior.
- Build fully custom only for genuinely app-specific UI — and still style with tokens (`design-system`) and meet `a11y-mobile` (live score announcements, leader marked by more than color).

## Own them — but don't break a11y

- The `ui/*` files are yours: tweak freely. But **don't strip the Reka behavior** (aria, focus, keyboard) — that's the value.
- Re-running `add` for an existing component **overwrites** your edits — don't re-add a customized one blindly.

## Styling

- Tailwind utility classes bound to theme tokens (`bg-background`, `text-foreground`, `bg-primary`, `border-border`) — see `design-system`. No arbitrary values; use the scale.
- Keep 44px targets + thumb-zone rules from `a11y-mobile` / `vue-pinia`.

## Keep it lean

- Copy-in ships **only the components you use** — add as needed, not a big batch.

## This project (card-scorekeeper)

Likely set: `button input label table sheet dialog alert-dialog sonner switch tabs`. Scoreboard = `Table`; round nav = `Tabs`; photo-count confirm = `Dialog`/`Sheet`; remove-player/end-game = `AlertDialog`; sync/error feedback = `Sonner`; theme toggle = `Switch`. The offline banner is custom (styled from `design-system` tokens) but announced per `a11y-mobile`.
