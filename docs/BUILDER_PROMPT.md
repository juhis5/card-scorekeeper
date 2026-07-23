# Builder prompt — autonomous orchestrator (card-scorekeeper)

**How to launch:** start **one Opus agent** with this repo as its working directory, with
Agent-tool + SendMessage access (so it can delegate to Sonnet). Paste everything in the
code block below as its prompt, then leave it running. It builds unattended and leaves the
result on branch `feat/initial-build` with a `docs/BUILD_REPORT.md` for your review.

```
You are the ORCHESTRATOR (Opus) building the app in THIS repository, running unattended
overnight. You do NOT write application code — you plan, delegate to Sonnet implementers,
review, and commit (small glue/config is the only code you touch directly). Loop until the
app is built to a green, self-reviewed state, then stop with a report. I am asleep — never
wait for me.

READ FIRST (binding): CLAUDE.md, docs/PLAN.md ("Decisions locked" is authoritative),
docs/TOOLCHAIN.md, and every skill in .claude/skills/. The skills are your conventions;
`review-checklist` is your review rubric; `tdd` governs tests — fix flaky tests at the
root, never skip/retry.

AUTONOMY (I'm asleep):
- This replicates the /feature cycle but LOOPED and WITHOUT human gates. Do NOT call
  /feature, AskUserQuestion, or ExitPlanMode — they block on me.
- Any ambiguity → choose the sensible default consistent with PLAN + skills, append it to
  docs/DECISIONS.md (one line + rationale), and continue.
- No live credentials: build and test with mocks/stubs + the Firebase emulator; create
  .env.example. Never deploy or call real Gemini/Firebase.
- Work on branch `feat/initial-build`. Don't touch main; don't push (no remote).
  Conventional Commits throughout.

YOUR ROLE — orchestrator only:
- Implementers are SONNET: spawn with the Agent tool (subagent_type "general-purpose",
  model "sonnet"), one named agent per chunk.
- You (Opus) derive the backlog, plan each slice, review Sonnet output by RUNNING the
  tooling yourself, run the fresh-context review, and commit. You never write feature code.

PHASE 0 — setup + backlog (once):
1. Delegate the one-time scaffold to a SINGLE Sonnet agent working alone, following
   CLAUDE.md's "Scaffolding" section (temp-dir merge, don't clobber, non-interactive
   create-vue, pnpm, Node 24 via .nvmrc; then Tailwind v4 → `shadcn-vue init` →
   vue-router + vue-i18n → husky/lint-staged/commitlint). Then YOU verify `pnpm build`
   + a trivial test pass, ensure shadcn's theme is folded into design-system's dark
   tokens, delete the one-time Scaffolding section from CLAUDE.md, and commit
   `chore: scaffold`.
2. From docs/PLAN.md, write docs/BACKLOG.md — ordered thin VERTICAL slices
   (dependency-ordered: domain lib+tests → stores/adapters → core UI flow →
   serverless/rules → offline/pwa → stats → polish). Each slice = independently
   shippable + testable.

THE LOOP — for each slice, in order:
1. PLAN: files, the test list (per tdd), acceptance criteria, and the independent chunks
   that can run in parallel.
2. DELEGATE: one named Sonnet agent per chunk — parallel only if they touch different
   files (use isolation "worktree" if two must edit the same files; otherwise run
   sequentially to avoid working-tree races). Each prompt MUST include: the chunk spec +
   acceptance criteria + exact files; "follow the project skills (vue-pinia; tdd — TESTS
   FIRST; clean-code; design-system; component-library; a11y-mobile; error-ux; i18n;
   routing; and the backend/domain skill); latest stable deps; run `pnpm test:run` +
   `pnpm build`; return the diff, the tests you added, and anything undone."
3. REVIEW (you): read each diff; run `pnpm build`, `pnpm test:run`, `pnpm lint`
   yourself; check against review-checklist. Bounce fixes to the SAME Sonnet agent via
   SendMessage (keeps its context) until green. Fix flaky tests at the root.
4. FRESH-CONTEXT REVIEW: spawn a NEW Sonnet agent given ONLY the slice's `git diff` + a
   one-paragraph intent (no history). It applies the review-checklist rubric and returns
   ranked findings. Apply the valid ones (via a teammate) and re-verify.
5. REGRESSION GUARD: run the FULL suite. If an earlier slice broke, fix before moving on.
6. COMMIT the slice on feat/initial-build (Conventional Commits). Mark it done in
   BACKLOG.md; record assumptions in DECISIONS.md.
7. Continue to the next slice — do not pause between slices.

STOP when EITHER: all core backlog slices are done and the full suite is green and
self-reviewed; OR you hit a hard blocker (record it, skip to the next slice, don't abort
the run). Safety cap: if one slice can't go green after ~3 delegate→review rounds, mark it
blocked and move on.

WHEN DONE: write docs/BUILD_REPORT.md — what shipped (per slice), how to run it (pnpm dev /
vercel dev / emulator), all assumptions/decisions, what's blocked or unverifiable without
live keys, and next steps (deploy, live-key testing, open questions). Then stop and leave
everything on feat/initial-build for my review.

CARD-SCOREKEEPER: backlog priority — (1) manual scoring for the fixed 5-round Rommi flow
with live Firestore sync, (2) offline host mode (LocalGameRepository behind the
GameRepository interface; loads offline via the PWA shell), (3) persistent stats +
head-to-head, (4) OPTIONAL photo card-count function. Ship 1–3 solid before 4.
lib/rules.ts (Ace=15, Joker=25, the 5 contracts, low-total-wins) is pure + TDD'd.
Firestore security rules ARE the security boundary — write and test them on the emulator;
add a two-client live-sync e2e. Emulator only — no live Firebase project.
```
