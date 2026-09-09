#!/usr/bin/env bash
set -euo pipefail

parameter_name="${1:-}"

if [[ ! "$parameter_name" =~ ^/oxy/[^[:space:]]+$ ]]; then
  echo "parameter name must be an exact /oxy/... path" >&2
  exit 2
fi

# Read the protected value only from stdin. AWS CLI resolves file:///dev/stdin
# as the value, so neither the shell process table nor the aws argv contains it.
# Passing the entire request through --cli-input-json file:///dev/stdin is not
# portable across AWS CLI releases: the runner's current CLI rejects that
# non-seekable JSON source before making the request.
aws ssm put-parameter \
  --name "$parameter_name" \
  --value file:///dev/stdin \
  --type SecureString \
  --overwrite >/dev/null
