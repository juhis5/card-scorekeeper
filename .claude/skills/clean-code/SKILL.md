---
name: clean-code
description: Non-negotiable clean-code rules for this project — naming, function size, typing, error handling, formatting (Prettier + ESLint). Read before writing or editing any code. Clean code is a hard requirement here, not a nice-to-have.
---

# Clean code — the standard for this repo

Concrete and enforced, not vibes. Prettier owns formatting; ESLint owns correctness/style; these rules own structure and intent.

## Formatting & linting (automated)

- **Prettier is the single source of truth for formatting.** Never argue with it, never hand-format. A repo-root `.prettierrc` config plus a `.prettierignore` define the style. It also runs automatically after edits (see the repo's `.claude/settings.json` hook) — so committed code is always formatted.
- **ESLint** (flat config, `eslint-plugin-vue` + `typescript-eslint`) catches real problems: unused vars, `no-explicit-any`, unreachable code, missing `await`, Vue-specific pitfalls. Fix warnings; don't silence them with `// eslint-disable` unless you write why on the same line.
- Install latest stable: `pnpm add -D prettier prettier-plugin-tailwindcss eslint eslint-plugin-vue typescript-eslint @vue/eslint-config-typescript @vue/eslint-config-prettier`. `prettier-plugin-tailwindcss` auto-sorts Tailwind classes (it's in `.prettierrc.json`).
- Scripts: `"lint": "eslint . --fix"`, `"format": "prettier --write ."`.

## Naming

- Reveal intent: `workDays`, not `wd`; `parseShiftRow`, not `doStuff`. A good name removes the need for a comment.
- Booleans read as predicates: `isDayOff`, `hasError`, `canExport`.
- Functions are verbs (`buildIcs`, `validateShifts`); values are nouns. Components PascalCase, composables `useX`, stores `useXStore`.
- No abbreviations that aren't universal, no Hungarian notation, no `data`/`info`/`temp`/`obj` as names.

## Functions

- **Small, one job.** If you need "and" to describe it, split it. A function that fits on a screen without scrolling is the target.
- **Guard clauses over nesting.** Return early on the edge cases; keep the happy path un-indented. Max ~2 levels of nesting.
- Few parameters (≤3); pass an options object beyond that. No boolean flag params that fork behavior — split into two functions.
- **Prefer pure functions** in `lib/` — same input, same output, no side effects. They're trivial to test (see `tdd`) and reason about. Push side effects (network, DOM, storage) to the edges.

## Types (TypeScript strict)

- **No `any`.** Use precise types; `unknown` + narrowing at untyped boundaries (API/model responses), then validate before the value flows inward.
- Model the domain in `src/lib/types.ts`; make illegal states unrepresentable (discriminated unions over a soup of optional fields).
- No non-null `!` assertions to dodge the checker — handle the null.

## Structure & duplication

- **DRY, but not prematurely.** Extract a helper on the *second* real duplication, not the first — a wrong abstraction costs more than a little repetition.
- Colocate what changes together. One component's private helper lives with it; shared helpers go to `lib/`.
- No dead code, no commented-out blocks (git remembers), no unused exports. Delete it.

## Constants & magic values

- No magic numbers/strings. Name them: `const ACE_VALUE = 15`, `const TIMEZONE = 'Europe/Helsinki'`. Fixed domain rules live in a typed constant module, not scattered literals.

## Error handling

- Handle errors at the boundary (the fetch wrapper, the serverless handler), not swallowed deep inside. Never `catch {}` silently — recover, or surface a clear message to the UI, or rethrow.
- Fail loud in dev, graceful in UI: the user sees "couldn't read the photo, type it in", not a stack trace.
- No `console.log` in committed code. Use it while debugging, remove before commit (ESLint flags it).

## Comments

- Comment **why**, not **what**. The code says what. A comment earns its place by explaining a non-obvious decision, a workaround, or a gotcha.
- Keep them true — a stale comment is worse than none. Update or delete comments when the code changes.

## Vue-specific cleanliness

- `<script setup>` order: imports → props/emits/models → composables/stores → local state → computed → functions → lifecycle/watchers.
- No logic in templates beyond simple expressions — move it to a `computed` with a name.
- One responsibility per component; extract a child or composable when it grows two.
- Style with Tailwind utility classes bound to theme tokens (`bg-background`, `text-foreground`, `p-4`) — see `design-system`. No arbitrary values (`mt-[13px]`); use the scale. Reserve `<style scoped>` for the rare thing utilities can't express. Prefer shadcn-vue primitives over hand-built ones (see `component-library`).
