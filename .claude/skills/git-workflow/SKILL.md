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

## Branches

- `main` is the protected default. Work on `<type>/<short-desc>`: `feat/photo-count`, `fix/room-expiry`. Don't commit non-trivial work straight to `main` (matches the harness's branch-first rule).

## Git hooks (husky + lint-staged + commitlint) — the "typical hooks"

Wire after the first `pnpm install` (needs `package.json`). Install latest: `pnpm add -D husky lint-staged @commitlint/cli @commitlint/config-conventional`, then `pnpm exec husky init`.

- **`commit-msg`** → `commitlint` — rejects non-conventional messages. `commitlint.config.js` extends `@commitlint/config-conventional`.
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

`.github/workflows/ci.yml` mirrors the hooks server-side so nothing slips: on push/PR to `main` → install (pnpm via corepack) → lint → typecheck → unit test → build. Add a **Firestore-rules job on the emulator** when rules change (see `firestore-realtime` / `tdd`). Keep it in sync with the `package.json` scripts; it activates once the app is scaffolded.

## Don't

- No `--no-verify` to skip hooks; no force-push to `main`; never commit failing or flaky tests.
- Squash-merge PRs (title = a conventional commit) to keep `main` history clean (optional but tidy).
