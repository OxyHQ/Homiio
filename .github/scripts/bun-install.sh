#!/usr/bin/env bash
# `bun install`, with its output kept and judged rather than thrown away.
#
# Every install in CI goes through this. The reason is in assert-install-clean.sh:
# bun has printed `error: Fail extracting tarball` and then exited 0, leaving a
# package absent from the tree, and everything downstream then fails for a reason
# that has nothing to do with the commit. Trusting the exit code alone is what
# turns that into "N pre-existing errors" in somebody's report.
#
# Arguments are passed through to `bun install` (e.g. --frozen-lockfile).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="${RUNNER_TEMP:-/tmp}/bun-install.log"

bun install "$@" 2>&1 | tee "$LOG"
STATUS=${PIPESTATUS[0]}

exec bash "$HERE/assert-install-clean.sh" "$LOG" "$STATUS"
