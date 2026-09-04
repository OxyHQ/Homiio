#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
subject="$repo_root/.github/scripts/put-secure-parameter.sh"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

export TEST_AWS_ARGV_FILE="$scratch/aws.argv"
export TEST_AWS_STDIN_FILE="$scratch/aws.stdin"
aws() {
  printf '%s\n' "$@" >"$TEST_AWS_ARGV_FILE"
  cat >"$TEST_AWS_STDIN_FILE"
}
export -f aws

secret='homiio-secret-that-must-never-enter-argv'
printf '%s' "$secret" | bash "$subject" /oxy/homiio/JWT_SECRET

if grep -Fq -- "$secret" "$TEST_AWS_ARGV_FILE"; then
  echo 'protected value leaked into aws argv' >&2
  exit 1
fi

mapfile -t argv <"$TEST_AWS_ARGV_FILE"
expected=(ssm put-parameter --cli-input-json file:///dev/stdin)
if [[ "${argv[*]}" != "${expected[*]}" ]]; then
  printf 'unexpected aws argv: %q\n' "${argv[@]}" >&2
  exit 1
fi

jq -e \
  --arg secret "$secret" \
  '.Name == "/oxy/homiio/JWT_SECRET" and
   .Value == $secret and
   .Type == "SecureString" and
   .Overwrite == true' \
  "$TEST_AWS_STDIN_FILE" >/dev/null

echo 'Homiio SecureString stdin and argv test passed.'
