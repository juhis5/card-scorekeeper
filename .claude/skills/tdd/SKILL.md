---
name: tdd
description: How and when to do test-driven development in this project. Pragmatic TDD — strict test-first for logic, behavior tests for components, a few E2E on critical flows, no testing of CSS. Read before writing any store, composable, lib helper, serverless handler, or component, and before adding the test setup.
---

# TDD — pragmatic, for a Vue + TS app

TDD is worth it here **where inputs and outputs are clear**. It is not worth it for pixels. Match the rigor to the code.

Install latest stable: `pnpm add -D vitest @vue/test-utils happy-dom @testing-library/vue @playwright/test`. For Firestore rules add `@firebase/rules-unit-testing`. Version numbers anywhere in these docs are floors — always install the current latest.

## The rule of thumb

| Code | Approach |
|------|----------|
| `lib/` pure logic (Rommi `rules.ts`, scoring, validators), Pinia stores, composables, serverless handler logic, Firestore security rules | **Strict TDD** — write the failing test first, then the code. |
| Components | **Behavior tests**, written alongside — assert what the user sees/does (scoreboard sorts ascending, entering a round score updates the total, contract banner shows the right round). Not test-first-mandatory. |
| Critical user flows | **A few Playwright E2E** — host creates room → second client joins with the code → a score entered on one client appears on the other. |
| CSS, layout, exact styling, animations, framework glue | **Don't unit-test.** Verify by eye on a phone viewport. |

Don't chase a coverage number. Coverage is a signal (untested logic branch = write a test), not a target.

## The loop (for logic)

1. **Red** — smallest failing test stating the next behavior. Watch it fail for the right reason.
2. **Green** — least code to pass.
3. **Refactor** — clean up (see `clean-code`) with tests green.
4. Repeat. Commit at green.

## What to test where

- **`lib/rules.ts`** — the highest-value TDD target here. Test the fixed rules exactly: card values (2–9 = 5, 10 = 10, J/Q/K = 10, Ace = 15, Joker = 25; repeated cards from 2–3 decks each count); a round total sums correctly; the 5 contracts map round → required melds; winner = lowest total after round 5; ties handled. Pure functions with exact expected values — ideal for test-first.
- **Stats logic** — win rate, best/worst round, head-to-head derivation from `game_player` rows. Pure functions over fixtures; TDD them (the identity caveats don't change the math).
- **Stores (Pinia)** — fresh Pinia per test (`setActivePinia(createPinia())`). Mock Firestore (`onSnapshot`/writes) at the boundary — never hit real Firebase in unit tests. Test that a snapshot payload maps to sorted standings, that the current round advances, that permissions are respected in the action.
- **Serverless photo-count** — unit-test the pure parts: room+token gate logic, rate-limit windows, server-side recompute of the card total, response validation. Mock the Gemini SDK and the Admin SDK. Assert: no valid room/token → 403, over cap → 429, bad model output rejected.
- **Firestore security rules** — test with `@firebase/rules-unit-testing` against the emulator: a player can edit their own score but not another's; the host can edit anyone's in their room; writes to an expired room are rejected; reads are room-scoped. **Rules are the security boundary — test them like code.**
- **Components** — `@vue/test-utils` / Testing Library. Behavior only: scoreboard renders sorted, score input commits, contract banner text. Query by role/text, not CSS class.

## Test hygiene

- One behavior per test; name as a sentence: `it('sorts standings ascending so lowest total leads')`.
- Arrange–Act–Assert. No logic in tests.
- Deterministic: no real network, no real clock, no real Firebase (emulator only, and only for rules/integration). Pass fixed dates/UUIDs in.
- Fast unit tests in `happy-dom`; keep the emulator + E2E suites small and separate.
- Test behavior and public contracts, not private internals.

## Flaky tests — a flake is a bug; fix it, never skip it

A test that passes *sometimes* is worse than one that fails — it trains everyone to ignore red. **When a test is flaky (fails intermittently, or "passes on re-run"), stop and fix the root cause.** Do NOT: re-run until green, add `retry`, `.skip`/`.only`, an arbitrary `setTimeout`/sleep, or loosen the assertion to make it pass. Those hide the bug; they don't fix it.

Common FE causes → the real fix:
- **Racing async/DOM** (asserting before Vue updated): `await flushPromises()` / `await nextTick()`, and Testing Library's `await findBy*` / `await waitFor(...)` instead of immediate `getBy*`; `await` every `user-event`.
- **Real timers** for debounce/throttle/delays: `vi.useFakeTimers()` + `vi.advanceTimersByTime()` — never wait wall-clock. To assert a rejection that only happens after time advances, capture it first (`const outcome = promise.catch((error: unknown) => error)`), advance, then `expect(await outcome)`. Don't leave an un-awaited `expect(promise).rejects`: the pre-commit `eslint --fix` (`vitest/valid-expect`) adds the `await`, and the test then hangs before the clock moves.
- **Non-determinism** (`Date.now()`, `new Date()`, `Math.random()`, locale/timezone): inject or mock — `vi.setSystemTime(...)`, seed randomness, pin `TZ`/locale. (Room codes, UUIDs, timestamps — inject them.)
- **Test-order / shared state** bleeding between tests: fresh Pinia per test, `vi.clearAllMocks()` + reset stores/DOM in `beforeEach`, no module-level mutable state. Prove it: run shuffled (`vitest --sequence.shuffle`).
- **Unmocked I/O** (real network / Firebase): mock at the boundary; use the emulator deterministically — never hit a live service. Firestore snapshot timing is a classic flake source — drive it through a mocked/emulated repository, not the live SDK.
- **Leaked subscriptions/timers/listeners** across tests: unmount components, unsubscribe `onSnapshot` (`onScopeDispose`), clear timers.
- **Animations/transitions** racing assertions: disable in tests or await completion.

Reproduce before declaring it fixed: run it many times, shuffled — `for s in $(seq 1 20); do pnpm exec vitest run <file> --sequence.shuffle --sequence.seed=$s || break; done` (Vitest 4 has no repeat flag). Green 20/20 shuffled = fixed. For an emulator suite, loop the `pnpm test:*` script and count exit codes: a run can print "Tests passed" and still exit 1 on an unhandled error. If you genuinely can't fix it now it's a **blocker**, not a merge-through: quarantine only with a tracked issue + owner + deadline, never a silent `.skip`. Default: fix it now.

## Wiring

- `vitest.config.ts`: `environment: 'happy-dom'`, `globals: true`.
- Scripts: `"test": "vitest"`, `"test:run": "vitest run"`, `"test:rules": "firebase emulators:exec --only firestore,auth 'vitest run --config vitest.rules.config.ts'"`, `"test:e2e": "firebase emulators:exec --only firestore,auth 'playwright test'"`, `"test:e2e:ci"` (the CI variant: production build, Chromium + Firefox), `"lint:check": "eslint ."`. Build runs `vue-tsc`.
- Co-locate unit tests: `foo.ts` + `foo.test.ts`. Rules tests and E2E in their own folders.

## This project (card-scorekeeper)

Highest-leverage test-first targets: `lib/rules.ts` (card values + 5 contracts + winner), the stats/head-to-head derivation, the room+token gate and total-recompute in the photo-count function, and the Firestore security rules. One Playwright flow: two browser contexts, host + joiner, assert a score syncs live between them.
