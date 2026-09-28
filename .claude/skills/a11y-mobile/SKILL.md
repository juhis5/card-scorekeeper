---
name: a11y-mobile
description: Accessibility conventions for this mobile-first Vue app — semantic HTML, focus management, labels, mobile keyboards, live regions, contrast, reduced motion. Read before building any component, form, table, or dialog. Accessibility is a requirement, not a polish pass.
---

# Accessibility — mobile-first, built in from the start

Retrofitting a11y is painful; bake it in. This app is used one-handed at a card table, passed between people — clear semantics and big targets help everyone.

## Semantic HTML first

- Right element for the job: `<button>` for actions (never a clickable `<div>`), `<a>` for navigation, real headings in order, `<label>` for every input. A scoreboard is tabular — use a `<table>` (or an ARIA table) with proper headers, not nested divs.
- Correct elements give keyboard support, focus, and roles for free. Use ARIA only to fill gaps.

## Forms & mobile keyboards

- Every input has a programmatic label. Score entry: `inputmode="numeric"` (numeric pad), `enterkeyhint="done"`. Room code: `autocapitalize`/`autocomplete` tuned so codes are easy to type.
- Errors: `aria-invalid` + `aria-describedby` (see `error-ux`).

## Touch targets & layout

- Targets ≥ 44×44px, spaced. Primary actions (enter score, next round, snap hand) in the thumb zone. Single column readable for 2–6 players; respect `env(safe-area-inset-*)`. No hover reliance.

## Focus management

- Visible focus indicator always. Logical tab order.
- Dialogs/sheets (confirm end-game, edit player): trap focus, move focus in on open, return to trigger on close, `Esc` to close, backdrop inert while open.

## Live regions — important for live scores

- Announce meaningful live changes via `aria-live="polite"` so a player not staring at the screen still knows: "Maiju: 15 points saved" on save, and when a round is revealed "Round 2 results: Maiju leads with 30 points. You're in place 2." plus the next contract, in one message. Never announce a ranking before its round is revealed. Announce sparingly (not every keystroke or every write).
- Status ("reading your cards…") also goes through a polite live region (`role="status"`); inline errors use `role="alert"`. There are no toasts. Put announcements in a region that already exists in the DOM: one inserted with its text already in it is often not read. Reserve `assertive` for urgent errors.

## Color & contrast

- Text contrast ≥ 4.5:1 (≥ 3:1 large), in every theme (`src/assets/theme-contrast.test.ts` checks the token pairs).
- **Never encode meaning in color alone.** The leader, a negative/penalty, "your turn", the offline state — each needs text or an icon too, not just color. Card tables are often in mixed lighting.

## Motion

- Honor `prefers-reduced-motion`; gate non-essential animation (score-change flashes, confetti on win) behind it.

## Testing

- Keyboard-only pass; focus visible; dialogs trap/restore.
- Screen reader: VoiceOver on iOS (the real device). Verify score-sync announcements are useful, not noisy.
- Automated: axe / Lighthouse a11y — catches labels/contrast/roles; still do the manual passes (tools miss ~half).

## This project (card-scorekeeper)

The **scoreboard** is the a11y-critical surface: a real table with headers (player / round / total), sorted ascending (leader first) with the leader marked by text/icon not just color. Live score changes announced politely. The local-game badge and "whose turn / current contract" must be readable by a screen reader, not conveyed by color or position alone.
