---
name: component-library
description: How to use shadcn-vue (Reka UI + Tailwind v4) as the component library — setup, adding components, when to use a library component vs build custom, and keeping a11y intact. Read before building any UI element that has a common primitive (dialog, sheet, popover, radio group, switch, segmented toggle, table, select, dropdown).
---

# Component library — shadcn-vue (Reka UI + Tailwind v4)

Don't reinvent primitives. shadcn-vue gives **copy-in components you own**, built on **Reka UI** (accessible headless behavior — focus traps, keyboard, ARIA) and styled with **Tailwind v4** + our design tokens. The a11y-hard parts come for free; you keep full control of the code.

## Setup (once, by the scaffolding agent)

After `create-vue` + Tailwind v4 are in place:

```bash
pnpm dlx shadcn-vue@latest init          # sets components.json, lib/utils.ts (cn), the CSS theme
pnpm dlx shadcn-vue@latest add <name>              # one at a time, as needed
```

- Verify the current commands/flags against shadcn-vue docs — versions here are directional ("use latest").
- Components land in `src/components/ui/`. The `cn()` helper (clsx + tailwind-merge) lives in `src/lib/utils.ts` (kept at the top of `lib/`, where the shadcn CLI expects it).
- The theme (CSS variables in `src/assets/main.css`) is ours now — see the `design-system` skill. Never let `add` overwrite `button/` (customized).

## The rule: reach for a primitive first

Before hand-building anything, check if it's a solved primitive. Add it, don't rebuild it:

What's in the repo (`src/components/ui/`): `alert-dialog button card input label popover radio-group sheet switch table`, plus two shared components in `src/components/shared/`.

| Need | Component |
|------|-----------|
| Confirm / destructive action (remove player, end or leave a game) | `AlertDialog` |
| Mobile sheet (photo-count confirm, Enter all, invite, menu) | `Sheet` — there is no `Dialog`; use a `Sheet` or `AlertDialog` |
| The scoreboard, head-to-head, highscore lists | `Table` |
| Field + validation (room code, name, score) | `Input` + `Label` |
| On/off setting ("Vain tällä laitteella") | `Switch` |
| Pick one of several (theme picker) | `RadioGroup` |
| Two-way view switch (Liity \| Uusi peli, Pelaajat \| Pelit) | `shared/SegmentedToggle.vue` (pressed buttons in a labelled group; the shadcn tabs were removed) |
| An ⓘ explanation | `shared/InfoPopover.vue` (over `Popover`) |
| Home / Join form surfaces | `Card` |
| Error / status feedback (see `error-ux`) | inline `role="alert"` / `role="status"` text; no toast library |

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

Scoreboard = `Table`; photo-count confirm = `PhotoCountSheet` (a `Sheet`); remove-player/end-game = `AlertDialog`; theme picker = `RadioGroup`; view toggles = `SegmentedToggle`; error feedback = inline alerts. There is no round navigation: the host moves on with Next. The local-game badge (`LocalGameBadge`) is a `Popover` in the header, announced per `a11y-mobile`. Add a new primitive only when a real need shows up.
