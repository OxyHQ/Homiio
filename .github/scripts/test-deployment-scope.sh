#!/usr/bin/env bash
# Mutation-tests deployment-scope.sh against a throwaway git repository.
#
# The script decides whether production gets a rollout, so the failure that costs
# something is a verdict of `false` that should have been `true`: production stays
# on old code and the workflow reports success. A scope check that answered
# `false` to everything would look identical to a quiet week. Both verdicts are
# therefore asserted on real commits with real diffs.
#
# ## The case this file exists for now (#430)
#
# The backend hazard was never one rule being wrong. It was two correct rules in
# combination — a run EVICTED while pending on main, and a documentation-only
# commit landing next — so testing either separately proves nothing about the
# interaction. `evicted_then_docs_only` below reproduces the pair.
#
# A harness cannot evict a GitHub run, and does not need to: the only thing an
# eviction changes about THIS script's input is that the previous commit never
# deployed and the next decision is taken one commit further along. That is
# exactly the fixture — a backend commit carrying a migration, then a
# documentation commit, with the verdict read at the documentation commit.
#
# ## Where the discrimination now lives
#
# Every backend verdict is `true` by design, so the backend cases can no longer
# tell a working script from `emit true` at the top of the file. The FRONTEND
# cases carry that weight: `frontend skips a backend-only commit` is the one
# assertion here that a stuck-open script fails, and it is why the frontend arm
# is exercised in both directions rather than only in the one this change
# touched.

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
expect "backend deploys on a docs-only commit" true "$(verdict backend docs/guide.md)"
expect "backend deploys on a root markdown commit" true "$(verdict backend AGENTS.md)"
expect "frontend deploys on frontend source" true "$(verdict frontend packages/frontend/app/index.tsx)"
expect "frontend deploys on shared-types" true "$(verdict frontend packages/shared-types/src/index.ts)"
expect "frontend deploys on the lockfile" true "$(verdict frontend bun.lock)"
expect "frontend skips a backend-only commit" false "$(verdict frontend packages/backend/server.ts)"
# The fail-open direction: anything the script cannot judge must still deploy.
expect "an unknown target deploys" true "$(verdict sideways packages/backend/server.ts)"

# ── The combination, which is the whole point (#430) ──
#
# Commit A carries a migration and its run is evicted while pending, so nothing
# deploys. Commit B is documentation. The verdict is read at B, which is the
# decision that decides whether A's migration ever reaches production.
#
# Under the per-commit rule this answered `false` and A's migration waited
# indefinitely behind however many documentation commits followed — measured at
# up to four consecutive on real history — with main green throughout.

# The verdict for a target at whatever HEAD already is, committing nothing.
verdict_at_head() {
  local target="$1" output
  output=$(cd "$WORKDIR" && GITHUB_OUTPUT=/dev/null DEPLOY_SHA=HEAD bash "$SCRIPT" "$target" 2>&1)
  printf '%s' "${output##*deploy=}" | cut -d' ' -f1
}

# A: the commit whose deploy is lost to the eviction.
mkdir -p "$WORKDIR/packages/backend/drizzle" "$WORKDIR/docs"
echo "create table t ();" >"$WORKDIR/packages/backend/drizzle/0099_probe.sql"
git -C "$WORKDIR" add -A >/dev/null
git -C "$WORKDIR" commit -qm "migration that never deployed" >/dev/null
# B: the documentation commit that lands next and takes the decision.
echo "$RANDOM" >>"$WORKDIR/docs/next.md"
git -C "$WORKDIR" add -A >/dev/null
git -C "$WORKDIR" commit -qm "docs only" >/dev/null

expect "an evicted migration is not stranded by a docs-only next commit" \
  true "$(verdict_at_head backend)"

# The SAME pairing, read for the frontend, must still SKIP. Three things this
# buys, and none of them is symmetry:
#   * it proves the fixture really is documentation-only, so the backend verdict
#     above comes from the new rule rather than from a fixture that quietly
#     touched something;
#   * the frontend has no migration to strand — the same combination costs a
#     stale bundle, and the frontend skip avoids 100 of 200 commits against the
#     backend's 10, which is the actual difference between the two arms (it is
#     NOT the export cost: that is 59 s, measured on run 31449277315, and the
#     "hour" it used to cite was `timeout-minutes: 60` read as a duration);
#   * it is one of the two assertions here that a stuck-open script fails.
expect "the same pairing still skips the frontend" false "$(verdict_at_head frontend)"

# And the streak, because one documentation commit is not the worst case. Real
# history carried FOUR consecutive documentation-only commits, so a fix that only
# looks back one commit would strand a migration behind the second one and pass
# the case above. A second documentation commit is appended and the verdict read
# again.
echo "$RANDOM" >>"$WORKDIR/docs/next2.md"
git -C "$WORKDIR" add -A >/dev/null
git -C "$WORKDIR" commit -qm "docs only, again" >/dev/null
expect "nor by a SECOND consecutive docs-only commit" true "$(verdict_at_head backend)"

if [ "$FAILURES" -gt 0 ]; then
  echo "Deployment scope tests failed: $FAILURES case(s)." >&2
  exit 1
fi
echo "Deployment scope check discriminated 11 case(s)."
