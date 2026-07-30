#!/usr/bin/env bash
# Mutation-tests deployment-scope.sh against a throwaway git repository.
#
# The script decides whether production gets a rollout, so the failure that costs
# something is a verdict of `false` that should have been `true`: production stays
# on old code and the workflow reports success. A scope check that answered
# `false` to everything would look identical to a quiet week. Both verdicts are
# therefore asserted for both targets, on real commits with real diffs.

set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deployment-scope.sh"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/homiio-scope-test-XXXXXX")"
FAILURES=0

cleanup() {
  trap - EXIT INT TERM
  rm -rf "$WORKDIR"
}
trap cleanup EXIT INT TERM

git -C "$WORKDIR" init -q .
git -C "$WORKDIR" config user.email fixture@example.invalid
git -C "$WORKDIR" config user.name fixture
mkdir -p "$WORKDIR/packages/frontend" "$WORKDIR/packages/backend" "$WORKDIR/docs"
echo base >"$WORKDIR/README.md"
git -C "$WORKDIR" add -A
git -C "$WORKDIR" commit -qm base

# Commits one changed file and returns the verdict the script gives for a target.
verdict() {
  local target="$1" path="$2"
  mkdir -p "$WORKDIR/$(dirname "$path")"
  echo "$RANDOM" >>"$WORKDIR/$path"
  git -C "$WORKDIR" add -A >/dev/null
  git -C "$WORKDIR" commit -qm "touch $path" >/dev/null
  local output
  output=$(cd "$WORKDIR" && GITHUB_OUTPUT=/dev/null DEPLOY_SHA=HEAD bash "$SCRIPT" "$target" 2>&1)
  printf '%s' "${output##*deploy=}" | cut -d' ' -f1
}

expect() {
  local label="$1" want="$2" got="$3"
  if [ "$got" != "$want" ]; then
    echo "- $label: expected deploy=$want, got deploy=$got" >&2
    FAILURES=$((FAILURES + 1))
  fi
}

expect "backend deploys on backend source" true "$(verdict backend packages/backend/server.ts)"
expect "backend skips a docs-only commit" false "$(verdict backend docs/guide.md)"
expect "backend skips a root markdown commit" false "$(verdict backend AGENTS.md)"
expect "frontend deploys on frontend source" true "$(verdict frontend packages/frontend/app/index.tsx)"
expect "frontend deploys on shared-types" true "$(verdict frontend packages/shared-types/src/index.ts)"
expect "frontend deploys on the lockfile" true "$(verdict frontend bun.lock)"
expect "frontend skips a backend-only commit" false "$(verdict frontend packages/backend/server.ts)"
# The fail-open direction: anything the script cannot judge must still deploy.
expect "an unknown target deploys" true "$(verdict sideways packages/backend/server.ts)"

if [ "$FAILURES" -gt 0 ]; then
  echo "Deployment scope tests failed: $FAILURES case(s)." >&2
  exit 1
fi
echo "Deployment scope check discriminated 8 case(s)."
