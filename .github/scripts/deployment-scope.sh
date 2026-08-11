#!/usr/bin/env bash
# Decides whether a deploy target has anything to deploy, and writes
# `deploy=true|false` to $GITHUB_OUTPUT.
#
# WHY THIS EXISTS AT ALL
#
# Both deploy workflows used to trigger on `push: main` with `paths` /
# `paths-ignore` filters. They now trigger on `workflow_run` after CI, because a
# push must not reach production before the suite has run — and `workflow_run`
# supports NO path filters. Without something in their place, a docs-only commit
# would rebuild and roll out the backend, and a backend-only commit would spend an
# hour re-exporting the web bundle. This restores the filters that the trigger
# change took away, and nothing more.
#
# IT FAILS OPEN, DELIBERATELY
#
# Two failure directions, and they are not symmetric: a needless deploy costs a
# rollout, while a SKIPPED deploy silently leaves production on old code with a
# green tick next to it. So every uncertainty resolves to deploy — an empty diff,
# an unreadable range, an unknown target, a commit with no parent.
#
# THE BACKEND NOW RESOLVES TO DEPLOY UNCONDITIONALLY (#430)
#
# The docs-only skip was correct in isolation and unsafe in combination. A run
# PENDING on `main` is EVICTED when a newer push arrives — `cancel-in-progress`
# is false for main, which protects a run that has STARTED and not a queued one —
# so a commit's own deploy can be dropped. If the NEXT commit is documentation,
# this check said `false`, nothing deployed, and `main` stayed green. Since #417
# armed migrations on deploy, what waits is a SCHEMA, and the symptom is the one
# this repository has already paid for once: `/health` answering `200 database:
# healthy` while queries fail on columns that do not exist.
#
# Measured on 2026-08-11 before choosing, over the last 200 first-parent commits
# on main using THIS script rather than a re-implementation of it:
#
#   * 10 commits (5%) were documentation-only — the whole value of the skip.
#   * 6 of those 10 landed immediately after a code commit, which is the exact
#     pairing the hazard needs.
#   * the longest run of consecutive documentation-only commits was 4, so the
#     wait was not merely possible but unbounded.
#   * 27 of the last 100 CI runs on main concluded `cancelled`, each with ZERO
#     jobs, i.e. evicted while pending.
#   * a backend deploy costs 10-13 minutes of runner time, so restoring those 10
#     deploys costs about two hours per 200 commits.
#
# WHY NOT KEEP THE SKIP AND MAKE IT SAFE. Skipping is safe only when nothing
# undeployed needs the backend, and this repository cannot answer "did an earlier
# commit deploy?" from inside a run:
#
#   * the deployed artefact carries only a digest, and mapping it back to a tag
#     needs `ecr:DescribeImages`, which is implicitDeny for oxy-github-deploy —
#     recorded in deploy-aws.yml where the build resolves its own digest for the
#     same reason;
#   * the live task definition records no commit at all (measured on
#     `oxy-homiio:80`: no SHA-shaped environment variable, `dockerLabels` null);
#   * the run's outcome lives in the Actions API, which this job has no
#     permission for — and an evicted run concluded `cancelled` with zero jobs,
#     so its record cannot distinguish "did not deploy" from "was not reached".
#
# So a scope check with no external state must assume the worst about every
# predecessor, walk back to the last code commit, and deploy — which, given that
# 6 of the 10 documentation commits sat directly on top of one, is this.
#
# A marker (a git ref, or a commit stamped into the task definition) would keep
# the optimisation and was rejected on failure DIRECTION, not on effort: a marker
# that is ever wrong skips a deploy, which is the failure being fixed,
# reintroduced by the fix. Two hours of runner time per 200 commits is the price
# of not having an invariant that can rot. If documentation-only commits ever
# become a large fraction of main — the measurement to re-run is the one above,
# and 5% is the number to beat — the trade is worth revisiting.
#
# THE RANGE
#
# `<sha>^1..<sha>`: first-parent, which is the whole of what a merge commit
# brought in and exactly the change a squash merge is. Those are how commits reach
# this repository's main. The one case it under-reads is a direct push of several
# non-merge commits, where only the last one is examined; that is why an empty or
# failed diff deploys rather than skips.

set -euo pipefail

TARGET="${1:-}"
SHA="${DEPLOY_SHA:-HEAD}"

emit() {
  echo "deploy=$1" >>"${GITHUB_OUTPUT:-/dev/stdout}"
  echo "$TARGET: deploy=$1${2:+ ($2)}"
  exit 0
}

if [ -z "$TARGET" ]; then
  echo "usage: deployment-scope.sh <backend|frontend>" >&2
  exit 1
fi

# An unknown target is a typo in a workflow, and a typo must not quietly disable a
# deploy forever.
case "$TARGET" in
  backend | frontend) ;;
  *) emit true "unknown target, deploying rather than skipping" ;;
esac

if ! CHANGED=$(git diff --name-only "$SHA^1" "$SHA" 2>/dev/null); then
  emit true "could not read the diff for $SHA"
fi
if [ -z "$CHANGED" ]; then
  emit true "no files reported for $SHA"
fi

case "$TARGET" in
  backend)
    # ALWAYS. The backend has no scope check any more, and the deletion is the
    # fix for #430 rather than a simplification — see the header section above.
    #
    # `$CHANGED` is still computed, and deliberately: the two fail-open branches
    # before this one (an unreadable diff, an empty diff) stay meaningful for the
    # frontend, and a target that silently stopped reading the diff would be the
    # kind of half-alive check this file exists to avoid.
    emit true "the backend always deploys; a per-commit skip is not safe here (#430)"
    ;;
  frontend)
    # Mirrors the old `paths:` allowlist verbatim.
    if printf '%s\n' "$CHANGED" |
      grep -qE '^(\.github/workflows/deploy-frontends\.yml$|packages/frontend/|packages/shared-types/|package\.json$|bun\.lock$)'; then
      emit true "a file the web bundle is built from changed"
    fi
    emit false "nothing the web bundle is built from changed"
    ;;
esac
