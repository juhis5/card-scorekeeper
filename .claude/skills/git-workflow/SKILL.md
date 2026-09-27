---
name: git-workflow
description: Git + automation conventions — Conventional Commits (v1.0.0), branch naming, git hooks (husky + lint-staged + commitlint), and CI (GitHub Actions). Read before committing, branching, opening a PR, or wiring hooks/CI.
---

# Git workflow — conventions + automation

## Conventional Commits (v1.0.0)

Spec: https://www.conventionalcommits.org/en/v1.0.0/ — format `type(scope): subject`.

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scope** optional, lowercase, the area: `feat(scoreboard): …`, `fix(rules): …`.
- **Subject:** imperative, lowercase, no trailing period, ≤ ~50 chars ("add", not "added").
- **Body** (optional, wrap ~72): the *why*, not the what.
- **Breaking change:** `type!: …` and/or a `BREAKING CHANGE: …` footer.
- **Footers:** references etc. (`Refs: #12`).
- Examples: `feat(room): offline local game`, `fix(rules): ace counts as 15 not 11`, `test(rules): cover winner tiebreak`.

## Branches (gitflow, fast-forward releases)

- **`develop`** is the default branch and where work lands. Branch from it as `<type>/<short-desc>` (`feat/photo-count`, `fix/room-expiry`) and open the PR into `develop`. Squash-merge only; the ruleset requires a PR, green `verify`/`rules`/`e2e` and an up-to-date branch. It deploys to **test-rommi.vercel.app** (staging Firebase).
- **`main`** is production (**rommi.vercel.app**, prod Firebase). It only ever moves forward to a commit that's already on `develop`:
  1. Open a release PR `develop` → `main` so the shipped commits are listed and CI runs.
  2. On the owner's "release": deploy prod rules if they changed (`pnpm exec firebase deploy --only firestore:rules --project card-scorekeeper-prod-1673f`), then `git push origin develop:main`. That's a fast-forward, so `main` gets the exact commits `develop` has and GitHub marks the release PR merged by itself.
  3. Check rommi.vercel.app once Vercel's production build is done.
- **Never** use the release PR's merge buttons: squash and merge commits add a commit `develop` lacks, and GitHub's "Rebase and merge" rewrites every commit id even when nothing needs rebasing. Either way the branches drift and the next release PR carries old commits again. `main`'s ruleset has no PR rule for this reason; it still requires the three checks on the pushed commit, linear history, no force-push and no deletion.
- **Hotfixes** go through `develop` too: a fix PR, then a release. Keep `develop` releasable: a half-done feature stays on its branch.
- Firestore rules: deploy a PR's rules to **staging** before merging it into `develop` (test-rommi and the previews run on staging), and to **prod** before the release that carries them. Keep rules changes additive, so each environment can take the new rules before the new app.

## Git hooks (husky + lint-staged + commitlint) — the "typical hooks"

Wire after the first `pnpm install` (needs `package.json`). Install latest: `pnpm add -D husky lint-staged @commitlint/cli @commitlint/config-conventional`, then `pnpm exec husky init`.

- **`commit-msg`** → `commitlint` — rejects non-conventional messages. The `commitlint` key in `package.json` extends `@commitlint/config-conventional`.
- **`pre-commit`** → `lint-staged` — `prettier --write` + `eslint --fix` on staged files only (fast).
- **`pre-push`** → `vue-tsc` (typecheck) + `vitest run` (unit). **This is where flaky tests bite — fix them (see `tdd`), never bypass with `--no-verify`.**
- These run for *any* committer/tool; separate from the Claude Code Prettier PostToolUse hook (which formats as Claude edits).

`lint-staged` (in `package.json`):
```json
"lint-staged": {
  "*.{ts,vue,js,json,css,md}": ["prettier --write"],
  "*.{ts,vue}": ["eslint --fix"]
}
```

## CI (GitHub Actions)

`.github/workflows/ci.yml` mirrors the hooks server-side so nothing slips: on push/PR to `develop` or `main` → install (pnpm via corepack) → lint → typecheck → unit test → build. Add a **Firestore-rules job on the emulator** when rules change (see `firestore-realtime` / `tdd`). Keep it in sync with the `package.json` scripts; it activates once the app is scaffolded.

## Don't

- No `--no-verify` to skip hooks; no force-push to `main` or `develop`; never commit failing or flaky tests.
- Squash-merge feature PRs into `develop` (title = a conventional commit) to keep history clean; releases fast-forward `main`, never merge.
