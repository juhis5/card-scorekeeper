---
name: error-ux
description: Conventions for loading / empty / error / offline states, toasts, form validation, and destructive-action confirms. Read before building any screen with an async operation, a form, or a network call — the user should never see a blank screen or a raw error.
---

# Error & state UX — never a blank screen, never a raw stack

Every async operation has **four** states, each designed, not left to chance:

1. **Loading** — in flight.
2. **Success** — data is here.
3. **Empty** — succeeded but nothing to show.
4. **Error** — it failed.

A component that only handles success is a bug.

## Loading

- Spinner/skeleton; **disable the submit control while pending** (no double-fire on "join room" / "next round").
- Keep prior content visible during a live refresh — don't flash to a spinner when you already have scores.
- Slow ops (photo card-count): reassure ("Reading your cards…") + `AbortController` timeout.

## Empty

- Friendly empty states that name the next action:
  - no players yet → "Waiting for players — share the room code."
  - no games in stats yet → "No finished games yet."
- Empty ≠ error.

## Error

- **Catch at the boundary** (the repository / api client / store action), not deep in a component (see `clean-code`).
- Human message + **retry**; never a raw stack, never a silent failure.
- Map failure classes: can't reach backend, invalid/expired room code (on join), 403 (bad session token on photo-count), 429 (rate-limited), bad photo read ("couldn't read the cards — type the total").
- Manual entry is always reachable: if photo-count fails, the number field is right there.

## Offline (this app has a real offline mode)

- Detect connectivity (`navigator.onLine` + events; treat failed writes as offline).
- On "start game" with the backend unreachable → **local host game** (see `firestore-realtime`). Show a clear, persistent banner: **"Offline — running a local game on this device."** Explain what's limited: no remote players joining, no photo-count; manual scoring works.
- During an **online** game that drops connection: Firestore's `persistentLocalCache` keeps it working; show a subtle "reconnecting…" indicator, not an error — scores still update locally and sync on reconnect.
- Distinguish the two clearly: "never connected → local game" vs "blip mid-game → reconnecting".

## Toasts

- One small toast system (`useToasts` composable or tiny store): `success`/`error`/`info`, auto-dismiss (~4s), manual dismiss, few at a time.
- Render in an `aria-live="polite"` region (see `a11y-mobile`). Announce meaningful live events — e.g. "Score synced" — sparingly, not every write.
- Toasts for transient feedback; inline messages for persistent field/section errors.

## Forms & validation

- Inline validation near the field, on blur/submit not every keystroke. Room code: validate length/format before calling the backend.
- Tie messages with `aria-describedby`, set `aria-invalid` (see `a11y-mobile`). Disable submit while invalid/pending.

## Destructive actions

- Confirm anything hard to undo: remove a player, reset a round, end the game early. Lightweight, focus-trapped, mobile-friendly confirm sheet. Enforce that the actor is allowed (host vs self) — the UI confirm is not the security boundary; Firestore rules are.

## This project (card-scorekeeper)

Cover explicitly: joining (invalid/expired code), live score updates (optimistic + reconcile with the snapshot), the two offline modes above, photo-count failure → manual. The offline banner is a first-class piece of UI here, not an afterthought — it's how the player knows they're in a local game.
