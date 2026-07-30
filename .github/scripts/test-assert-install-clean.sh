#!/usr/bin/env bash
# Mutation-tests assert-install-clean.sh against fixture logs.
#
# The case that matters is the one the exit code cannot see: an install that
# printed `error:` and exited 0. If this check ever stops discriminating that from
# a clean install, it reads as protection while providing none — and the symptom
# it protects against (a package missing from node_modules) surfaces later as
# "pre-existing type errors" that get believed.

set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/assert-install-clean.sh"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/homiio-install-clean-test-XXXXXX")"
FAILURES=0

cleanup() {
  trap - EXIT INT TERM
  rm -rf "$WORKDIR"
}
trap cleanup EXIT INT TERM

expect() {
  local label="$1" want_status="$2" want_fragment="$3" log="$4" status="$5"
  local output got
  output=$(bash "$SCRIPT" "$log" "$status" 2>&1)
  got=$?
  if [ "$got" != "$want_status" ]; then
    echo "- $label: expected exit $want_status, got $got" >&2
    echo "$output" >&2
    FAILURES=$((FAILURES + 1))
    return
  fi
  if [ -n "$want_fragment" ] && ! printf '%s' "$output" | grep -qF "$want_fragment"; then
    echo "- $label: output did not contain '$want_fragment'" >&2
    echo "$output" >&2
    FAILURES=$((FAILURES + 1))
  fi
}

cat >"$WORKDIR/clean.log" <<'LOG'
bun install v1.3.14 (0d9b296a)
+ typescript@6.0.3
1605 packages installed [512.00ms]
LOG

# The real shape, taken from the incident: an error line, then exit 0.
cat >"$WORKDIR/silent-failure.log" <<'LOG'
bun install v1.3.14 (0d9b296a)
error: Fail extracting tarball for "@homiio/shared-types"
1604 packages installed [488.00ms]
LOG

# A word containing "error" that is not an error line must not trip it, or the
# check becomes a thing people re-run until it passes.
cat >"$WORKDIR/false-positive-bait.log" <<'LOG'
bun install v1.3.14 (0d9b296a)
+ eslint-plugin-no-error-on-purpose@1.0.0
warn: an error-handling package changed major versions
1605 packages installed [512.00ms]
LOG

expect "clean install passes" 0 "no reported errors" "$WORKDIR/clean.log" 0
expect "error line with exit 0 fails" 1 "reported an error while exiting 0" "$WORKDIR/silent-failure.log" 0
expect "error line is named in the output" 1 'Fail extracting tarball' "$WORKDIR/silent-failure.log" 0
expect "a nonzero exit fails" 7 "exited 7" "$WORKDIR/clean.log" 7
expect "the word error elsewhere does not trip it" 0 "no reported errors" "$WORKDIR/false-positive-bait.log" 0
expect "a missing log fails" 1 "does not exist" "$WORKDIR/nope.log" 0

if [ "$FAILURES" -gt 0 ]; then
  echo "Install-clean assertion tests failed: $FAILURES case(s)." >&2
  exit 1
fi
echo "Install-clean check discriminated 6 case(s)."
