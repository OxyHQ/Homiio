#!/usr/bin/env bash
# Fails when a toolchain version is pinned in two places that have drifted.
#
# `packages/backend/Dockerfile` used to install bun with a bare
# `npm install -g bun`, which is not a pin at all: the image built today and the
# image built next month could resolve different bun versions from the same
# commit. That matters more here than anywhere else in the repository, because
# this Dockerfile narrows `workspaces` and deliberately never copies `bun.lock`
# — with no lockfile, the bun version is the only thing deciding how the
# dependency ranges resolve.
#
# Pinning it introduces the problem the ci.yml header was avoiding: a third copy
# of a version number to keep in step. This script is the answer to that. It is
# cheap, it runs on every pull request, and it turns silent drift into a red job
# that names both files.
#
# Node is checked the same way against `engines.node`, which is what everything
# else in the repository reads to decide which runtime it is targeting.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKERFILE="$ROOT/packages/backend/Dockerfile"
CI="$ROOT/.github/workflows/ci.yml"
PKG="$ROOT/package.json"
FAILURES=0

fail() {
  printf '::error::%s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

# --- bun --------------------------------------------------------------------
ci_bun="$(sed -nE "s/^[[:space:]]*BUN_VERSION:[[:space:]]*'([^']+)'.*/\1/p" "$CI" | head -1)"
docker_bun="$(sed -nE 's/^ARG BUN_VERSION=(.+)$/\1/p' "$DOCKERFILE" | head -1)"

if [[ -z "$ci_bun" ]]; then
  fail "could not read BUN_VERSION from $CI — the check cannot pass vacuously"
elif [[ -z "$docker_bun" ]]; then
  fail "could not read 'ARG BUN_VERSION=' from $DOCKERFILE — the check cannot pass vacuously"
elif [[ "$ci_bun" != "$docker_bun" ]]; then
  fail "bun pin drift: ci.yml says '$ci_bun', packages/backend/Dockerfile says '$docker_bun'"
else
  printf 'bun pinned to %s in both ci.yml and packages/backend/Dockerfile\n' "$ci_bun"
fi

# Every `npm install -g bun` must carry the pin; one that does not is unpinned
# however carefully the ARG above is maintained.
#
# Matched on RUN lines only. Matching the bare phrase anywhere in the file
# reported the comment above this Dockerfile's own install step — a check that
# fires on prose about itself is the kind that gets deleted rather than fixed.
run_installs=0
while IFS= read -r line; do
  run_installs=$((run_installs + 1))
  [[ "$line" == *'bun@${BUN_VERSION}'* ]] && continue
  fail "unpinned bun install in $DOCKERFILE: $line"
done < <(grep -nE '^[[:space:]]*RUN .*npm install -g bun' "$DOCKERFILE" || true)

if [[ "$run_installs" -eq 0 ]]; then
  fail "no 'RUN … npm install -g bun' found in $DOCKERFILE — the check cannot pass vacuously"
fi

# --- node -------------------------------------------------------------------
engines_major="$(sed -nE 's/.*"node":[[:space:]]*"([0-9]+)\..*/\1/p' "$PKG" | head -1)"
if [[ -z "$engines_major" ]]; then
  fail "could not read engines.node from $PKG — the check cannot pass vacuously"
fi

from_lines="$(grep -c '^FROM node:' "$DOCKERFILE" || true)"
if [[ "$from_lines" -eq 0 ]]; then
  fail "no 'FROM node:' stages found in $DOCKERFILE — the check cannot pass vacuously"
fi

while IFS= read -r line; do
  stage_major="$(printf '%s' "$line" | sed -nE 's/^FROM node:([0-9]+).*/\1/p')"
  if [[ -z "$stage_major" ]]; then
    fail "could not read a node major from: $line"
  elif [[ -n "$engines_major" && "$stage_major" != "$engines_major" ]]; then
    fail "node pin drift: package.json engines.node is ${engines_major}.x, Dockerfile has '$line'"
  fi
done < <(grep '^FROM node:' "$DOCKERFILE")

if [[ "$FAILURES" -eq 0 ]]; then
  printf 'node pinned to %s across %s stage(s), matching engines.node\n' "$engines_major" "$from_lines"
  exit 0
fi
exit 1
