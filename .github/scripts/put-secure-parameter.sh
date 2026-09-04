#!/usr/bin/env bash
set -euo pipefail

parameter_name="${1:-}"

if [[ ! "$parameter_name" =~ ^/oxy/[^[:space:]]+$ ]]; then
  echo "parameter name must be an exact /oxy/... path" >&2
  exit 2
fi

# Read the protected value only from stdin. The AWS CLI sees the payload on
# stdin too, so neither the shell process table nor the aws argv contains it.
jq -Rsc --arg name "$parameter_name" '{
  Name: $name,
  Value: .,
  Type: "SecureString",
  Overwrite: true
}' | aws ssm put-parameter --cli-input-json file:///dev/stdin >/dev/null
