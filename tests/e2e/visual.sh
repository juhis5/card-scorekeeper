#!/usr/bin/env bash
# Runs the visual snapshots in Playwright's Linux image, the same one CI uses, on x86 like CI's
# runners: baselines only match there. Extra arguments go to Playwright, e.g. --update-snapshots.
set -euo pipefail
IMAGE="mcr.microsoft.com/playwright:v$(node -p "require('@playwright/test/package.json').version")-noble"
docker run --rm --platform linux/amd64 --ipc=host \
  -v "$PWD":/work -v /work/node_modules -v card-scorekeeper-pnpm-store:/root/.local/share/pnpm \
  -w /work "$IMAGE" \
  bash -c "corepack enable && pnpm install --frozen-lockfile --config.confirmModulesPurge=false >/dev/null \
    && VISUAL=1 CI=1 pnpm exec playwright test -c tests/e2e --project=visual $*"
