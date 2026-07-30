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
    # Mirrors the old `paths-ignore: ['**.md', 'docs/**']`. Asked as "is anything
    # NOT documentation", so a file shape these two patterns do not describe
    # counts as code and deploys.
    if printf '%s\n' "$CHANGED" | grep -qvE '(\.md$|^docs/)'; then
      emit true "a non-documentation file changed"
    fi
    emit false "documentation only"
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
