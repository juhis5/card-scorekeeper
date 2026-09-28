---
name: review-checklist
description: The project's review rubric and merge gate. Read when reviewing a diff / PR / working changes, or when acting as the fresh-context reviewer in the /feature loop. Verifies correctness, no regressions, sufficient tests, adherence to every project skill, security, a11y, performance, and maintainability (no shortcut hacks).
---

# Review checklist — the merge gate

A change ships only if it is **correct, regression-free, well-tested, follows every project skill, and is clean/maintainable with no hacks**. This is the rubric; apply it in the `/feature` fresh-context review and for any standalone review.

## How to run the review

1. Get the **diff** and the **intent** (what the change is + why). A fresh-context reviewer (no implementation bias) is best.
2. **Verify empirically — don't eyeball.** Run:
   - `pnpm build` (vue-tsc → zero type errors)
   - `pnpm test:run` (unit); `pnpm test:api` if `api/` changed; `pnpm test:rules` (Firestore rules on the emulator) if rules changed; `pnpm test:integration` if a repository changed; `pnpm test:e2e` (starts the emulators) if the critical flow changed. Plain `pnpm e2e` has no emulator and can't run the live-sync spec.
   - `pnpm lint:check` and `pnpm format:check`. Never `pnpm lint` or `pnpm format` during a review: they rewrite the files under review.
   - the app itself if UI changed (real phone viewport), including the **offline cold-start** path if touched
3. Read every changed file against the rubric below.
4. **Report findings ranked most-severe first**: `file:line` — what's wrong — a concrete failure scenario or why it matters — a suggested fix. Use the `ReportFindings` tool if reviewing via the bundled `/code-review` flow; otherwise a ranked list. If it's clean, say what you verified — don't rubber-stamp.

## Rubric

### 1. Correctness & regressions
- Does it do what the intent says? Walk the edge cases.
- Build + tests + lint all green. No test deleted, skipped, or weakened to go green.
- No regression in touched areas; existing behavior still works.
- No `any`, no `!` non-null dodges, no `@ts-ignore` / `eslint-disable` without an inline reason.

### 2. Tests sufficient (per `tdd`)
- Logic (`lib/game/rules.ts`, stats, stores, composables, serverless) has test-first-grade coverage; new branches + edge cases covered.
- Components: **behavior** tested, not just "it renders".
- **Firestore security rules** changes have emulator tests (own-vs-other score edits, host override, expired room, room-scoped reads).
- Critical flow has/updates an e2e (two clients: an entered score shows as entered on the other live, and its number appears on both when the host moves on).
- Tests are deterministic (no real network/clock/Firebase — mock the boundary / use the emulator), meaningful, one behavior each.
- **No flaky tests.** No `retry`, `.skip`/`.only`, arbitrary sleeps, or loosened assertions to mask an intermittent failure — a flaky or order-dependent test is a **Block** (see `tdd`). Verify suspect tests with a shuffled seed loop (Vitest 4 has no repeat flag): `for s in $(seq 1 20); do pnpm exec vitest run <file> --sequence.shuffle --sequence.seed=$s || break; done`. For an emulator suite, loop the `pnpm test:*` script and judge each run by its exit code, not the "Tests passed" line.

### 3. Skills adherence — check the diff against each relevant skill
- **`vue-pinia`**: `<script setup lang="ts">`, setup stores + `storeToRefs`, typed emits / `defineModel`, small single-job components, dependencies point inward (`lib/` pure — no Vue/Firebase/IO in it), store depends on the `GameRepository` **interface** not Firestore directly.
- **`clean-code`**: intent-revealing names, small functions, guard clauses, no dead/commented code, no magic values (card values / contracts come from `rules.ts`), errors at the boundary, no `console.log`, DRY-but-not-premature.
- **`design-system`**: token utility classes only — **no raw hex, no arbitrary values**; works in all eight themes (dark and light), contrast pairs in `theme-contrast.test.ts`; elevation via surface (`bg-card`/`bg-muted`) not shadow; reduced-motion on score flashes / win celebration.
- **`component-library`**: reached for an existing primitive (`ui/` Table/Sheet/AlertDialog/Popover/RadioGroup/Switch, or `shared/` SegmentedToggle/InfoPopover) instead of hand-rolling; Reka a11y intact; no pointless `ui/` fork.
- **`a11y-mobile`**: semantic scoreboard table, labelled inputs (`inputmode="numeric"` for scores), focus trap+restore in dialogs, **live-region announcements for score/round changes**, contrast in every theme, ≥44px targets, leader/offline not conveyed by color alone.
- **Cross-platform:** works on **Android (Chrome), iOS (Safari), and a desktop browser**; responsive ~360px→wide with no overflow; camera (photo-count) has a file-upload fallback on desktop; no touch-only or hover-only interactions.
- **`error-ux`**: all four states; the **two offline modes** handled and distinguished (never-connected → local game, `LocalGameBadge`; blip mid-game → reconnecting); failures inline (`role="alert"`), no toasts; manual scoring always reachable.
- **`pwa`**: shell precache intact so **offline cold-start still loads and a local game is playable**; Firestore/Gemini not SW-cached (Firestore uses its own `persistentLocalCache`).
- **backend (`firestore-realtime`, `vercel-gemini`, `vercel-deploy`)**: Firestore rules are the security boundary (not the UI); public web config (`VITE_FIREBASE_*`) vs server-only secrets (`GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`) kept separate; photo-count gate (Firebase ID token, then a seat in a live room) + per-room/global rate limits present; total recomputed server-side; listeners unsubscribed.
- **`routing`**: routes lazy-loaded + named; guards thin (delegate to stores, no logic/mutation/network in a guard — offline nav must not block); focus moved + announced on navigation.
- **`i18n`**: no hardcoded user-facing strings (all via `t()` keys); numbers/dates via Intl; `<html lang>` = the active locale.
- **domain (`rules.ts`)**: card values (2–9=5, 10=10, J/Q/K=10, Ace=15, Joker=25; round score = multiple of 5; duplicates from 2–3 decks count per card), the 5 contracts, low-total-wins, tie handling — all correct and unit-tested.

### 4. Maintainability & aesthetics — no shortcut hacks
The bar: code should read like the surrounding code and be pleasant to maintain.
- **No hacks:** no hardcoded value that should be config, no copy-paste that should be shared, no swallowed errors (`catch {}`), no `setTimeout`-as-synchronization, no "TODO left as the actual fix", no commented-out code.
- Abstractions at the right altitude — not over-engineered, not a wrong/early abstraction. (The `GameRepository` seam is deliberate — offline vs online — not speculative.)
- Types model the domain; illegal states are hard to represent.
- New files land in the right place per the layout; names honest; comments explain **why** and are current.
- Nothing that would make you wince in six months.

### 5. Security
- Firestore rules enforce the permission model (own score vs host-any; expired rooms rejected; room-scoped reads). Admin creds + Gemini key server-only. Photo-count gate + rate limits correct; untrusted text never interpolated unsafely.
- Run `/security-review` for anything touching rules, `/api`, or identity (anonymous auth uid, ID tokens).

### 6. Performance (proportionate)
- No leaked `onSnapshot`/timers (cleaned up in `onScopeDispose`/`onUnmounted`); batch multi-player writes; stable list keys; no giant re-renders on each snapshot; image/base64 bounded.

## Severity
- **Block:** correctness, security (esp. rules gaps), regressions, missing tests for new logic/rules, user-harming skill violations (a11y, leaked secret, broken offline).
- **Should-fix:** maintainability, hacks, weak tests.
- **Nit:** style not already handled by Prettier/ESLint.

## This project (card-scorekeeper)
Pay special attention to: Firestore **rules** (test them, don't trust the UI), the **offline** path (cold-start loads + local game fully playable; reconnect pushes only the final result), live-score **a11y announcements**, `rules.ts` correctness, and secret/public env separation. Critical e2e: host + joiner, an entry syncs live and the round is revealed on both.
