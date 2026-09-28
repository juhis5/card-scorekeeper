---
name: error-ux
description: Conventions for loading / empty / error / offline states, inline alerts and live-region feedback, form validation, and destructive-action confirms. Read before building any screen with an async operation, a form, or a network call — the user should never see a blank screen or a raw error.
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
- Map failure classes: can't reach backend, invalid/expired room code (on join), photo-count 401 (missing/invalid Firebase ID token) and 403 (no seat, or the room is finished/expired/gone), 429 (rate-limited), bad photo read ("couldn't read the cards — type the total").
- Manual entry is always reachable: if photo-count fails, the number field is right there.

## Offline (this app has a real offline mode)

- Detect connectivity (`navigator.onLine` + events; treat failed writes as offline).
- On "start game" with the backend unreachable → **local host game** (see `firestore-realtime`). The header shows a persistent no-wifi badge (`LocalGameBadge`: icon + a tap for "Playing a local game on this device", not "You're offline"), and the room says it once to screen readers. No remote players joining, no photo-count; manual scoring works.
- During an **online** game that drops connection: Firestore's `persistentLocalCache` keeps it working; show a quiet "reconnecting…" status (`useConnectionStatus`), not an error — scores still update locally and sync on reconnect.
- Distinguish the two clearly: "never connected → local game" vs "blip mid-game → reconnecting".

## Feedback — inline alerts + live regions (no toasts)

- The app has no toast system. A failure shows **inline, where it happened**: a `role="alert"` message next to the action (a score, Next or Finish failing in RoomView, a sheet's error). Progress and quiet notices are `role="status"`.
- Confirmations and live events go through a persistent `aria-live="polite"` region that already exists in the DOM (the room's announcer, App.vue's route and update regions; see `a11y-mobile`). Announce sparingly, not every write.
- A new app version shows as a banner + menu row (`app-update` store), never an automatic reload.

## Forms & validation

- Inline validation near the field, on blur/submit not every keystroke. Room code: validate length/format before calling the backend.
- Tie messages with `aria-describedby`, set `aria-invalid` (see `a11y-mobile`). Disable submit while invalid/pending.

## Destructive actions

- Confirm anything hard to undo: remove a player, end or leave a game, delete a refused result. Use `AlertDialog` (focus-trapped, mobile-friendly). Enforce that the actor is allowed (host vs self) — the UI confirm is not the security boundary; Firestore rules are.

## This project (card-scorekeeper)

Cover explicitly: joining (invalid/expired code), live score updates (optimistic + reconcile with the snapshot), the two offline modes above, photo-count failure → manual. The local-game badge is a first-class piece of UI here, not an afterthought — it's how the player knows they're in a local game.
