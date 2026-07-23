---
description: Implement a feature end-to-end via the loop — plan, clarify, delegate coding to Sonnet teammates, review, then a fresh-context review.
argument-hint: <feature description, or a section of docs/PLAN.md>
---

You are the **orchestrator** (Opus) for this feature. You plan, delegate, and review — you do **not** write the feature code yourself (small glue/config is fine). Sonnet teammates write the code; a fresh agent reviews it.

Feature to build: **$ARGUMENTS**

Run this loop:

## 1. Plan the plan
- Read `docs/PLAN.md`, `CLAUDE.md`, and any files named in the request. Load the relevant skills: `vue-pinia`, `tdd`, `clean-code`, and the backend skill (`vercel-gemini` / `firestore-realtime`).
- Produce a concrete implementation plan:
  - the files to create/change and in what order,
  - the **test list first** (per the `tdd` skill — what gets strict test-first vs behavior tests vs E2E vs skipped),
  - how the work splits into **independent chunks** that can be built in parallel without editing the same files,
  - the risks and the open decisions.

## 2. Ask the questions
- Use `AskUserQuestion` for every real fork you can't resolve from the plan/code (API shape, data model, UX choice, library). Don't guess on decisions the user owns.
- Present the plan and get approval (`ExitPlanMode`) **before any code is written**. This is a human gate.

## 3. Delegate coding to Sonnet teammates
- For each independent chunk, spawn a **named** teammate: `Agent` with `subagent_type: "general-purpose"`, `model: "sonnet"`. Run independent chunks **in parallel** (multiple Agent calls in one message).
- Use `isolation: "worktree"` only if two teammates would touch the same files; otherwise skip it.
- Every teammate prompt MUST contain:
  - the chunk spec + explicit acceptance criteria + the exact file paths,
  - "**Follow the project skills**: `vue-pinia`, `tdd` (**write the tests FIRST** for logic), `clean-code`. Use the latest stable dependency versions.",
  - "Run `pnpm test:run` and `pnpm build` (vue-tsc). Return: the diff, the tests you added, and anything you couldn't do."

## 4. Review the Sonnet code (you, Opus)
- For each teammate result: read the diff, then run `pnpm build` and `pnpm test:run` yourself. Prettier runs automatically on edits via the repo hook.
- Apply the **`review-checklist`** skill as the rubric: tests meaningful, every relevant skill followed, no `any`, no secrets in the client, no shortcut hacks, mobile-first + a11y respected.
- Send fixes **back to the same teammate** via `SendMessage` (keeps their context) rather than silently fixing. Iterate until typecheck + tests are green.

## 5. Fresh-context review
- With everything green, capture the full `git diff` of the feature and write a short **intent statement**: what the feature is and why it changed what it changed.
- Spawn a **new** teammate (`general-purpose`, fresh context) passed **only** the diff + the intent — no plan, no conversation history. Tell it to apply the **`review-checklist`** skill as its rubric (correctness, regressions, test sufficiency, every project skill, security, a11y, maintainability/no-hacks) and whether the code matches the stated intent, and to return concrete findings ranked by severity.
- Relay its findings to the user. Apply the agreed ones (back through the relevant teammate).

## Rules
- Human gates: plan approval (step 2) and final findings (step 5). Don't blow past them.
- TDD per the `tdd` skill: test-first for logic (stores, composables, `lib/`, serverless, rules); behavior tests for components; a few E2E on the critical flow; don't test CSS.
- You orchestrate and review in steps 3–5; you don't write the feature code.
