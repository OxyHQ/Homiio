#!/usr/bin/env bash
# Decides whether a `bun install` actually completed, from its log and its exit
# status. Kept separate from the install itself so it can be exercised against
# fixture logs — see test-assert-install-clean.sh.
#
# WHY THE EXIT CODE IS NOT ENOUGH
#
# `bun install` has printed `error: Fail extracting tarball for "<pkg>"` and then
# **exited 0**, leaving that package absent from node_modules with a correct
# lockfile and a clean `git status`. Everything downstream then fails for a reason
# that has nothing to do with the commit: dozens of TS2307s in files nobody
# touched, which get reported as "N pre-existing errors" and believed. It is
# transient (cache contention with a concurrent install), so a retry fixes it —
# but only if somebody realises that is what happened, and the exit code says the
# install was fine.
#
# So the install's own output is read too, and the two are allowed to disagree.

set -uo pipefail

LOG="${1:-}"
STATUS="${2:-}"

if [ -z "$LOG" ] || [ -z "$STATUS" ]; then
  echo "usage: assert-install-clean.sh <install-log> <install-exit-status>" >&2
  exit 1
fi

if [ ! -f "$LOG" ]; then
  echo "::error::The install log $LOG does not exist, so whether the install completed is unknown." >&2
  exit 1
fi

if [ "$STATUS" -ne 0 ]; then
  echo "::error::\`bun install\` exited $STATUS." >&2
  exit "$STATUS"
fi

# grep exits 1 on no match, which is the good case here.
REPORTED=$(grep -E '^[[:space:]]*error:' "$LOG" || true)
if [ -n "$REPORTED" ]; then
  echo "::error::\`bun install\` reported an error while exiting 0, so the dependency tree is incomplete. Re-run the job; this is usually transient." >&2
  printf '%s\n' "$REPORTED" >&2
  exit 1
fi

echo "bun install completed with no reported errors."
