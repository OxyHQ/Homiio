#!/usr/bin/env bash
# Mutation-tests check-version-pins.sh against throwaway copies of the files.
#
# The failure that costs something is a check that passes on drift, so every
# assertion below breaks exactly one pin and requires the script to (a) exit
# non-zero and (b) NAME the thing it is complaining about. A check that failed
# for every input would satisfy (a) alone, which is why the clean case is
# asserted first and why the messages are matched rather than just the status.

set -uo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPTS/../.." && pwd)"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/homiio-pins-test-XXXXXX")"
FAILURES=0

cleanup() {
  trap - EXIT INT TERM
  rm -rf "$WORKDIR"
}
trap cleanup EXIT INT TERM

# A fixture tree the script can run against without touching the real one.
seed() {
  rm -rf "$WORKDIR/tree"
  mkdir -p "$WORKDIR/tree/.github/scripts" "$WORKDIR/tree/.github/workflows" "$WORKDIR/tree/packages/backend/worker-runtime"
  cp "$REPO/packages/backend/worker-runtime/package.json" "$WORKDIR/tree/packages/backend/worker-runtime/"
  cp "$SCRIPTS/check-version-pins.sh" "$WORKDIR/tree/.github/scripts/"
  cp "$REPO"/.github/workflows/*.yml "$WORKDIR/tree/.github/workflows/"
  cp "$REPO/packages/backend/Dockerfile" "$WORKDIR/tree/packages/backend/"
  cp "$REPO/package.json" "$WORKDIR/tree/"
}

# expect <label> <expected-status> <substring-that-must-appear>
expect() {
  local label="$1" want="$2" needle="${3:-}" out status
  out="$(bash "$WORKDIR/tree/.github/scripts/check-version-pins.sh" 2>&1)"
  status=$?
  if [[ "$status" -ne "$want" ]]; then
    printf 'FAIL %s: expected exit %d, got %d\n%s\n' "$label" "$want" "$status" "$out"
    FAILURES=$((FAILURES + 1))
    return
  fi
  if [[ -n "$needle" && "$out" != *"$needle"* ]]; then
    printf 'FAIL %s: exit %d was right but the output never mentioned %q\n%s\n' \
      "$label" "$status" "$needle" "$out"
    FAILURES=$((FAILURES + 1))
    return
  fi
  printf 'ok   %s\n' "$label"
}

seed
expect "clean tree passes" 0 "bun pinned to"

seed
sed -i 's/^ARG BUN_VERSION=.*/ARG BUN_VERSION=9.9.9/' "$WORKDIR/tree/packages/backend/Dockerfile"
expect "bun drift is caught and named" 1 "bun pin drift"

seed
sed -i 's|oven/bun:${BUN_VERSION}|oven/bun:latest|' "$WORKDIR/tree/packages/backend/Dockerfile"
expect "an unpinned bun image is caught" 1 "unpinned bun image"

seed
printf 'RUN npm install -g bun\n' >> "$WORKDIR/tree/packages/backend/Dockerfile"
expect "bun installed through npm is caught" 1 "unpinned bun install through npm"

seed
sed -i '/oven\/bun/d' "$WORKDIR/tree/packages/backend/Dockerfile"
expect "a missing bun stage fails instead of passing vacuously" 1 "cannot pass vacuously"

seed
sed -i -E 's/"packageManager": "bun@[^"]+"/"packageManager": "bun@9.9.9"/' "$WORKDIR/tree/package.json"
expect "a packageManager bump the image and CI did not follow is caught" 1 "package.json pins bun@9.9.9"

seed
sed -i "s/^  BUN_VERSION: '.*'/  BUN_VERSION: '9.9.9'/" "$WORKDIR/tree/.github/workflows/ci.yml"
expect "ci.yml drifting from packageManager is caught" 1 "ci.yml BUN_VERSION says '9.9.9'"

seed
cat > "$WORKDIR/tree/.github/workflows/stray.yml" <<'YAML'
jobs:
  x:
    steps:
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "9.9.9"
YAML
expect "a literal bun-version in another workflow is caught" 1 "stray.yml"

seed
sed -i -E 's/"packageManager": "bun@[^"]+"/"packageManager": "bun"/' "$WORKDIR/tree/package.json"
expect "a missing packageManager pin fails instead of passing vacuously" 1 "cannot pass vacuously"

seed
sed -i 's/^FROM node:[0-9]*/FROM node:18/' "$WORKDIR/tree/packages/backend/Dockerfile"
expect "node drift is caught and named" 1 "node pin drift"

seed
sed -i 's/^ARG BUN_VERSION=.*/ARG NOT_THE_PIN=1.0.0/' "$WORKDIR/tree/packages/backend/Dockerfile"
expect "a missing bun pin fails instead of passing vacuously" 1 "cannot pass vacuously"

seed
sed -i "s/  BUN_VERSION: '.*'/  NOT_BUN_VERSION: 'x'/" "$WORKDIR/tree/.github/workflows/ci.yml"
expect "a missing ci.yml pin fails instead of passing vacuously" 1 "cannot pass vacuously"

seed
sed -i -E 's/"playwright": "[^"]+"/"playwright": "9.9.9"/' "$WORKDIR/tree/packages/backend/worker-runtime/package.json"
expect "a playwright package bump the browser image did not follow is caught" 1 "playwright pin drift"

seed
sed -i 's/^ARG PLAYWRIGHT_VERSION=.*/ARG PLAYWRIGHT_VERSION=9.9.9/' "$WORKDIR/tree/packages/backend/Dockerfile"
expect "a browser image bump the playwright package did not follow is caught" 1 "playwright pin drift"

seed
sed -i 's|mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-|mcr.microsoft.com/playwright:v1.0.0-|' "$WORKDIR/tree/packages/backend/Dockerfile"
expect "a browser image tag that ignores PLAYWRIGHT_VERSION is caught" 1 "not pinned to PLAYWRIGHT_VERSION"

seed
sed -i '/mcr.microsoft.com\/playwright/d' "$WORKDIR/tree/packages/backend/Dockerfile"
expect "a missing browser image stage fails instead of passing vacuously" 1 "cannot pass vacuously"

seed
sed -i 's/^ARG PLAYWRIGHT_VERSION=.*/ARG NOT_THE_PIN=1.0.0/' "$WORKDIR/tree/packages/backend/Dockerfile"
expect "a missing playwright pin fails instead of passing vacuously" 1 "cannot pass vacuously"

if [[ "$FAILURES" -ne 0 ]]; then
  printf '\n%d mutation(s) went undetected.\n' "$FAILURES"
  exit 1
fi
printf '\nAll mutations detected.\n'
