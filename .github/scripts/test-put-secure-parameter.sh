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
expected=(ssm put-parameter --name /oxy/homiio/JWT_SECRET --value file:///dev/stdin --type SecureString --overwrite)
if [[ "${argv[*]}" != "${expected[*]}" ]]; then
  printf 'unexpected aws argv: %q\n' "${argv[@]}" >&2
  exit 1
fi

if [[ "$(<"$TEST_AWS_STDIN_FILE")" != "$secret" ]]; then
  echo 'protected value was not passed intact through stdin' >&2
  exit 1
fi

echo 'Homiio SecureString stdin and argv test passed.'
