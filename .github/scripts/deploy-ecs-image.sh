#!/usr/bin/env bash

set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${CLUSTER:?CLUSTER is required}"
: "${APP:?APP is required}"
: "${IMAGE_URI:?IMAGE_URI is required}"
if [[ ! "$IMAGE_URI" =~ ^.+@sha256:[0-9a-fA-F]{64}$ ]]; then
  echo "::error::IMAGE_URI must pin an immutable OCI digest (repository@sha256:<64 hex characters>)."
  exit 1
fi

CONTAINER_NAME="${CONTAINER_NAME:-$APP}"
MAX_WAIT_SECS="${MAX_WAIT_SECS:-1200}"
POLL_INTERVAL="${POLL_INTERVAL:-15}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-false}"
INTERNAL_METRICS_PARAMETER="${INTERNAL_METRICS_PARAMETER:-}"
TASK_ENV_OVERRIDES_JSON="${TASK_ENV_OVERRIDES_JSON:-}"
TASK_SECRET_OVERRIDES_JSON="${TASK_SECRET_OVERRIDES_JSON:-}"
TASK_CONFIGURATION_REMOVALS_JSON="${TASK_CONFIGURATION_REMOVALS_JSON:-}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
AWS_PARTITION="${AWS_PARTITION:-aws}"
POST_DEPLOY_SMOKE_SCRIPT="${POST_DEPLOY_SMOKE_SCRIPT:-}"
POST_DEPLOY_TASK_COMMAND_JSON="${POST_DEPLOY_TASK_COMMAND_JSON:-}"
# Which ECS service's deploy lane runs the one-shot migrations.
#
# Homiio's two services share ONE image, and `deploy-aws.yml` rolls the API and
# then the worker through this same script. Left unset, `RUN_MIGRATIONS=true`
# would therefore run the migrator TWICE per release — wasted at best, and at
# worst a race: `db/migrate.ts` takes no cross-process advisory lock, and neither
# does drizzle. That was recorded as a precondition carried out of Lote 0 on the
# reasoning that nothing could run two migrators concurrently; `deploy-aws.yml`
# now sets `RUN_MIGRATIONS: 'true'`, so this variable is what keeps that true
# WITHIN a release, and the workflow's `concurrency` group is what keeps it true
# ACROSS releases. See `packages/backend/db/migrate.ts` for what remains open.
#
# Naming the owning SERVICE, rather than trusting each lane to set the flag
# correctly, is what makes a job-level `RUN_MIGRATIONS: true` safe: the worker
# lane sees the same flag and still declines. Unset keeps the historical
# behaviour for any single-service caller.
MIGRATION_SERVICE="${MIGRATION_SERVICE:-}"

# What `RUN_MIGRATIONS=true` runs, in order, each as its own one-shot task on the
# image being rolled out. A non-zero exit from any of them stops the release
# before `update-service`.
#
# ORDER IS LOAD-BEARING, AND THE MIGRATION RUNS BEFORE `update-service`.
#
# A task that boots against a database the migrations never reached connects,
# answers the `/health` check, is handed traffic by the target group, and only
# THEN fails every query — the damage lands after the point of no return rather
# than before it. Run first, a failure costs nothing, because nothing has been
# routed yet.
#
# `node`, NOT `bun`: the production image runs `CMD ["node",
# "packages/backend/dist/server.js"]` and its runtime stage installs production
# dependencies only, so there is no bun in it. The path is `dist/db/migrate.js`
# because `tsconfig.build.json` EXCLUDES `scripts/` from the emit, which is why
# the migrator lives at `packages/backend/db/migrate.ts` in the first place.
#
# This replaces a hardcoded `["bun","packages/backend/dist/scripts/migrate.js"]`
# that was wrong on both counts and named a file that has never existed in this
# repository — so `RUN_MIGRATIONS=true` could never once have worked here. It
# was also never set: nothing turned it on until 2026-08-10, by which point
# production was four migrations behind and answering 500 on two routes.
#
# `--phase=pre` is the only side this table runs. The `post` phase runs AFTER
# the rollout, through `POST_DEPLOY_TASK_COMMAND_JSON` below, and `deploy-aws.yml`
# sets it on the WORKER lane — the last service to roll, and therefore the first
# moment no old image is serving. A `post` migration drops or narrows something,
# so running it from this table would break the image still running.
#
# THE POPULATION FLOOR IS STILL THE ENTRY THAT IS NOT HERE, AND THE REASON HAS
# CHANGED. `db/assertPostgresPopulated.ts` asserts that Postgres is AUTHORITATIVE.
# That was false before the cutover and would have been false again after the
# planned rollback to Mongo, which is why this comment used to say the cutover
# commit would append the entry and a revert would remove it.
#
# The cutover has happened and there is no rollback target: `AGENTS.md`'s data
# storage section records that `models/`, `db/backfill/` and mongoose are deleted,
# `MONGODB_URI` is off both task definitions and out of SSM, and the only copy of
# the old data is an offline dump. So the ORIGINAL objection is gone.
#
# What replaces it is narrower and has to be measured rather than reasoned about:
# the five floors are numbers taken from a Mongo census on 2026-08-06, and no one
# has counted the rows Postgres holds today. Wiring a floor that production does
# not clear blocks every deploy, which is the failure this guard exists to avoid
# causing. Count first, then append this entry verbatim:
#
#   ,
#   {
#     "label": "Postgres population floor",
#     "command": ["node", "packages/backend/dist/db/assertPostgresPopulated.js"]
#   }
#
# It goes LAST because it counts rows, so the schema has to exist before there is
# anything to count.
MIGRATION_TASK_COMMANDS_JSON='[
  {
    "label": "Postgres migration",
    "command": ["node", "packages/backend/dist/db/migrate.js", "--target-database=homiio", "--phase=pre"]
  }
]'
# Exit code a smoke script uses to say "this failed, and rolling back cannot fix
# it" — a check that crosses a boundary this deploy does not own (a CDN in front
# of the origin, another service the route consults). Reverting the image for one
# of those trades a working deployment for an outage somebody else is already
# fixing, so the release stands and the job goes red instead.
#
# Every OTHER non-zero code still rolls back, so a smoke script that does not opt
# into the protocol keeps the previous all-or-nothing behaviour.
SMOKE_NO_ROLLBACK_EXIT=75
smoke_reported_external_failure=false
DEPLOY_HEAD_GUARD_SCRIPT="${DEPLOY_HEAD_GUARD_SCRIPT:-.github/scripts/require-current-main.sh}"

if ! [[ "$MAX_WAIT_SECS" =~ ^[0-9]+$ ]] || (( MAX_WAIT_SECS < 1 )); then
  echo "::error::MAX_WAIT_SECS must be a positive integer."
  exit 1
fi
if ! [[ "$POLL_INTERVAL" =~ ^[0-9]+$ ]] || (( POLL_INTERVAL < 1 )); then
  echo "::error::POLL_INTERVAL must be a positive integer."
  exit 1
fi
if [[ "$RUN_MIGRATIONS" != "true" && "$RUN_MIGRATIONS" != "false" ]]; then
  echo "::error::RUN_MIGRATIONS must be either 'true' or 'false'."
  exit 1
fi

# Does THIS lane own the migration one-shots?
#
# SKIP rather than refuse, and the direction is deliberate. The API lane rolls
# first and has already applied the schema by the time the worker lane starts, so
# skipping here is never wrong. Refusing would exit 1 on the worker, stranding it
# on the old image with the API already migrated — the exact class of failure
# this whole batch exists to prevent, reintroduced by the guard meant to prevent
# it. It is announced rather than silent, because a check nobody can see ran is
# indistinguishable from one that did not.
migrations_run_in_this_lane="$RUN_MIGRATIONS"
if [[ "$RUN_MIGRATIONS" == "true" &&
      -n "$MIGRATION_SERVICE" &&
      "$MIGRATION_SERVICE" != "$APP" ]]; then
  migrations_run_in_this_lane=false
  echo "::notice::Skipping migrations for $APP: MIGRATION_SERVICE=$MIGRATION_SERVICE owns them, and both targets share one compiled migration ledger. The migrator holds no cross-process lock, so it runs exactly once per release."
fi
if [[ -n "$POST_DEPLOY_SMOKE_SCRIPT" && ! -f "$POST_DEPLOY_SMOKE_SCRIPT" ]]; then
  echo "::error::POST_DEPLOY_SMOKE_SCRIPT does not exist: $POST_DEPLOY_SMOKE_SCRIPT"
  exit 1
fi
if [[ -n "${DEPLOY_SHA:-}" && ! -f "$DEPLOY_HEAD_GUARD_SCRIPT" ]]; then
  echo "::error::DEPLOY_HEAD_GUARD_SCRIPT does not exist: $DEPLOY_HEAD_GUARD_SCRIPT"
  exit 1
fi
if [[ -n "$POST_DEPLOY_TASK_COMMAND_JSON" ]] &&
   ! jq -e '
     type == "array" and
     length > 0 and
     all(.[]; type == "string" and length > 0)
   ' <<<"$POST_DEPLOY_TASK_COMMAND_JSON" >/dev/null; then
  echo "::error::POST_DEPLOY_TASK_COMMAND_JSON must be a non-empty JSON string array."
  exit 1
fi
if [[ -z "$TASK_ENV_OVERRIDES_JSON" ]]; then
  TASK_ENV_OVERRIDES_JSON='{}'
fi
if ! jq -e '
  type == "object" and
  length <= 20 and
  all(
    to_entries[];
    (.key | type == "string" and test("^[A-Z][A-Z0-9_]{0,127}$")) and
    (.value | type == "string" and length > 0 and length <= 4096)
  )
' <<<"$TASK_ENV_OVERRIDES_JSON" >/dev/null; then
  echo "::error::TASK_ENV_OVERRIDES_JSON must map environment variable names to non-empty strings."
  exit 1
fi
if [[ -z "$TASK_SECRET_OVERRIDES_JSON" ]]; then
  TASK_SECRET_OVERRIDES_JSON='{}'
fi
if ! jq -e '
  type == "object" and
  length <= 20 and
  all(
    to_entries[];
    (.key | type == "string" and test("^[A-Z][A-Z0-9_]{0,127}$")) and
    (
      .value
      | type == "string" and
        test("^arn:aws(-[a-z]+)?:ssm:[a-z0-9-]+:[0-9]{12}:parameter/[A-Za-z0-9_./-]+$")
    )
  )
' <<<"$TASK_SECRET_OVERRIDES_JSON" >/dev/null; then
  echo "::error::TASK_SECRET_OVERRIDES_JSON must map environment variable names to complete SSM parameter ARNs."
  exit 1
fi
if ! jq -e -n \
  --argjson environment "$TASK_ENV_OVERRIDES_JSON" \
  --argjson secrets "$TASK_SECRET_OVERRIDES_JSON" \
  '([$environment | keys[]] - [$secrets | keys[]] | length) == ($environment | length)'; then
  echo "::error::TASK_ENV_OVERRIDES_JSON and TASK_SECRET_OVERRIDES_JSON must not name the same variable."
  exit 1
fi
if [[ -z "$TASK_CONFIGURATION_REMOVALS_JSON" ]]; then
  TASK_CONFIGURATION_REMOVALS_JSON='[]'
fi
if ! jq -e '
  type == "array" and
  length <= 20 and
  length == (unique | length) and
  all(.[]; type == "string" and test("^[A-Z][A-Z0-9_]{0,127}$"))
' <<<"$TASK_CONFIGURATION_REMOVALS_JSON" >/dev/null; then
  echo "::error::TASK_CONFIGURATION_REMOVALS_JSON must be an array of unique environment variable names."
  exit 1
fi
if ! jq -e -n \
  --argjson environment "$TASK_ENV_OVERRIDES_JSON" \
  --argjson secrets "$TASK_SECRET_OVERRIDES_JSON" \
  --argjson removals "$TASK_CONFIGURATION_REMOVALS_JSON" \
  '(([$environment | keys[]] + [$secrets | keys[]]) - $removals | length) == (($environment | length) + ($secrets | length))'; then
  echo "::error::A task variable cannot be both overridden and removed."
  exit 1
fi

service_json="$(aws ecs describe-services --cluster "$CLUSTER" --services "$APP")"
if [[ "$(jq '.failures | length' <<<"$service_json")" != "0" ||
      "$(jq '.services | length' <<<"$service_json")" != "1" ]]; then
  echo "::error::ECS did not return exactly one service named $APP."
  jq '.failures' <<<"$service_json"
  exit 1
fi
service_status="$(jq -r '.services[0].status // "NONE"' <<<"$service_json")"
if [[ "$service_status" != "ACTIVE" ]]; then
  echo "::error::ECS service $APP is not ACTIVE (status: $service_status)."
  exit 1
fi

current_task_definition="$(jq -r '.services[0].taskDefinition // empty' <<<"$service_json")"
if [[ -z "$current_task_definition" ]]; then
  echo "::error::ECS service $APP has no task definition."
  exit 1
fi

service_desired_count="$(jq -r '.services[0].desiredCount // empty' <<<"$service_json")"
# Split from the zero-count check below on purpose. A non-numeric or missing
# desiredCount is ECS telling us it does not know the answer, and NO
# authorisation covers that — the exemption is for a count deliberately set to
# zero, not for an unreadable one.
if ! [[ "$service_desired_count" =~ ^[0-9]+$ ]]; then
  echo "::error::ECS service $APP reported a non-numeric desiredCount (${service_desired_count:-missing}); refusing to deploy."
  exit 1
fi
# desiredCount 0 is a STATE, not an error, and it needs no authorisation to be
# recognised as one. Both Homiio services are parked at zero for the whole of a
# store cutover on purpose, and refusing the deploy there is self-sealing: the
# image that would make the service bootable again is the image the refusal
# blocks, so the parked state can never be left.
#
# What this must NOT become is a green deploy that reports a release nobody got.
# So the release still does everything that is real at zero capacity — it runs
# the migrations, registers the revision, and POINTS THE SERVICE AT IT — and then
# stops at the one step that is not real, the rollout, and says so loudly.
#
# Pointing the service is the half that is easy to leave out and expensive to
# skip. `register-task-definition` alone does not repoint anything: ECS launches
# whatever revision the SERVICE is configured with, so a later `desiredCount`
# bump would start the OLD image, and this script derives its next render from
# `services[0].taskDefinition` (see `current_task_definition` above), so every
# subsequent deploy would keep building on the stale revision too. Homiio has TWO
# services and each carries its own revision, so each has to be repointed by its
# own lane.
zero_capacity_deploy=false
if (( service_desired_count < 1 )); then
  zero_capacity_deploy=true
fi

task_definition_file="$(mktemp)"
rendered_task_definition_file="$(mktemp)"
active_one_shot_task_arn=""
active_one_shot_task_stopped=true
active_one_shot_label=""

cleanup() {
  if [[ "$active_one_shot_task_stopped" != "true" &&
        -n "$active_one_shot_task_arn" ]]; then
    echo "::warning::Unfinished $active_one_shot_label task $active_one_shot_task_arn may still be running; the deploy role cannot call ecs:StopTask."
  fi
  rm -f "$task_definition_file" "$rendered_task_definition_file"
}
trap cleanup EXIT

wait_for_task_stop() {
  local task_arn="$1"
  local label="$2"
  local max_wait_secs="$3"
  local elapsed=0
  local task_json last_status

  while (( elapsed < max_wait_secs )); do
    task_json="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn")"
    if [[ "$(jq '.failures | length' <<<"$task_json")" != "0" ]]; then
      echo "::error::ECS could not describe $label task $task_arn."
      jq '.failures' <<<"$task_json"
      return 1
    fi
    last_status="$(jq -r '.tasks[0].lastStatus // "MISSING"' <<<"$task_json")"
    echo "($elapsed s) $label task status=$last_status"
    if [[ "$last_status" == "STOPPED" ]]; then
      return 0
    fi
    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))
  done

  echo "::error::$label task did not stop within ${max_wait_secs}s. The deploy role cannot call ecs:StopTask; task $task_arn may still be running."
  return 1
}

wait_for_service_rollout() {
  local task_definition="$1"
  local label="$2"
  local elapsed=0
  local deployment_json="$service_json"
  local deployment_state rollout_state running desired service_desired

  while (( elapsed < MAX_WAIT_SECS )); do
    if ! deployment_json="$(aws ecs describe-services \
      --cluster "$CLUSTER" \
      --services "$APP")"; then
      echo "::warning::Unable to inspect the $label rollout; retrying."
      sleep "$POLL_INTERVAL"
      elapsed=$((elapsed + POLL_INTERVAL))
      continue
    fi
    if [[ "$(jq '.failures | length' <<<"$deployment_json")" != "0" ]]; then
      echo "::warning::ECS returned a failure while inspecting the $label rollout; retrying."
      sleep "$POLL_INTERVAL"
      elapsed=$((elapsed + POLL_INTERVAL))
      continue
    fi
    if ! deployment_state="$(jq -r --arg task "$task_definition" '
      .services[0] as $service
      |
      [
        $service.deployments[]
        | select(.taskDefinition == $task and .status == "PRIMARY")
        | [.rolloutState, .runningCount, .desiredCount, $service.desiredCount]
        | @tsv
      ][0] // empty
    ' <<<"$deployment_json")"; then
      echo "::warning::ECS returned malformed rollout data for $label; retrying."
      sleep "$POLL_INTERVAL"
      elapsed=$((elapsed + POLL_INTERVAL))
      continue
    fi

    if [[ -z "$deployment_state" ]]; then
      echo "($elapsed s) waiting for the $label PRIMARY deployment"
    else
      IFS=$'\t' read -r rollout_state running desired service_desired <<<"$deployment_state"
      echo "($elapsed s) $label rolloutState=$rollout_state running=$running desired=$desired serviceDesired=$service_desired"
      if ! [[ "$running" =~ ^[0-9]+$ &&
              "$desired" =~ ^[0-9]+$ &&
              "$service_desired" =~ ^[0-9]+$ ]]; then
        echo "::warning::ECS returned non-numeric task counts for the $label rollout; retrying."
      # These two refusals are UNCONDITIONAL, and they are the protection that
      # survives the zero-capacity path above. A service that STARTED this deploy
      # with capacity and reached zero part-way through has lost it — that is a
      # real regression, not a parked service, and it must stay red. A release
      # that begins at zero never enters this loop at all: it exits before the
      # rollout, so there is nothing here for it to be exempted from.
      elif (( service_desired < 1 )); then
        echo "::error::ECS service $APP reached desiredCount=0 during the $label rollout."
        return 1
      elif [[ "$rollout_state" == "COMPLETED" ]]; then
        if (( desired < 1 )); then
          echo "::error::ECS $label rollout for $APP completed at desiredCount=0; refusing to accept a zero-task steady state."
          return 1
        fi
        if [[ "$running" == "$desired" ]]; then
          return 0
        fi
      elif (( desired < 1 )); then
        echo "::warning::ECS has not assigned desired tasks to the $label PRIMARY deployment yet; waiting."
      fi
      if [[ "$rollout_state" == "FAILED" ]]; then
        echo "::error::ECS $label rollout for $APP failed."
        echo "::group::Recent ECS service events"
        jq -r '
          .services[0].events[:10][]?
          | "\(.createdAt // "unknown") \(.message // "unknown")"
        ' <<<"$deployment_json"
        echo "::endgroup::"
        return 1
      fi
    fi

    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))
  done

  echo "::error::ECS $label rollout for $APP did not complete within ${MAX_WAIT_SECS}s."
  echo "::group::Recent ECS service events"
  jq -r '
    .services[0].events[:10][]?
    | "\(.createdAt // "unknown") \(.message // "unknown")"
  ' <<<"$deployment_json"
  echo "::endgroup::"
  return 1
}

print_one_shot_logs() {
  local task_arn="$1"
  local label="$2"
  local task_id log_group log_stream_prefix log_stream log_json

  task_id="${task_arn##*/}"
  log_group="$(jq -r --arg name "$CONTAINER_NAME" '
    .containerDefinitions[]
    | select(.name == $name)
    | .logConfiguration.options["awslogs-group"] // empty
  ' "$rendered_task_definition_file")"
  log_stream_prefix="$(jq -r --arg name "$CONTAINER_NAME" '
    .containerDefinitions[]
    | select(.name == $name)
    | .logConfiguration.options["awslogs-stream-prefix"] // empty
  ' "$rendered_task_definition_file")"

  if [[ -z "$task_id" || -z "$log_group" || -z "$log_stream_prefix" ]]; then
    echo "::warning::Unable to derive the CloudWatch log stream for failed $label task $task_arn."
    return 0
  fi

  log_stream="$log_stream_prefix/$CONTAINER_NAME/$task_id"
  if ! log_json="$(aws logs get-log-events \
    --log-group-name "$log_group" \
    --log-stream-name "$log_stream" \
    --limit 200 \
    --start-from-head)"; then
    echo "::warning::Unable to read CloudWatch logs for failed $label task $task_arn."
    return 0
  fi

  echo "::group::$label CloudWatch logs"
  jq -r '.events[]?.message' <<<"$log_json"
  echo "::endgroup::"
}

run_one_shot_command() {
  local label="$1"
  local command_json="$2"
  local overrides run_json task_json exit_code stopped_reason container_reason

  overrides="$(jq -cn \
    --arg name "$CONTAINER_NAME" \
    --argjson command "$command_json" \
    '{
      containerOverrides: [{
        name: $name,
        command: $command
      }]
    }')"

  if ! run_json="$(aws "${one_shot_run_task_args[@]}" --overrides "$overrides")"; then
    echo "::error::ECS failed to start the $label task."
    return 1
  fi
  if [[ "$(jq '.failures | length' <<<"$run_json")" != "0" ]]; then
    echo "::error::ECS refused to start the $label task."
    jq '.failures' <<<"$run_json"
    return 1
  fi

  active_one_shot_task_arn="$(jq -r '.tasks[0].taskArn // empty' <<<"$run_json")"
  if [[ -z "$active_one_shot_task_arn" ]]; then
    echo "::error::ECS returned no task ARN for $label."
    return 1
  fi
  active_one_shot_label="$label"
  active_one_shot_task_stopped=false

  echo "Running $label with $new_task_definition"
  if ! wait_for_task_stop "$active_one_shot_task_arn" "$label" "$MAX_WAIT_SECS"; then
    return 1
  fi
  active_one_shot_task_stopped=true

  task_json="$(aws ecs describe-tasks \
    --cluster "$CLUSTER" \
    --tasks "$active_one_shot_task_arn")"
  exit_code="$(jq -r --arg name "$CONTAINER_NAME" '
    .tasks[0].containers[] | select(.name == $name) | .exitCode // -1
  ' <<<"$task_json")"
  if [[ "$exit_code" != "0" ]]; then
    print_one_shot_logs "$active_one_shot_task_arn" "$label"
    stopped_reason="$(jq -r '.tasks[0].stoppedReason // "unknown"' <<<"$task_json")"
    container_reason="$(jq -r --arg name "$CONTAINER_NAME" '
      .tasks[0].containers[] | select(.name == $name) | .reason // "unknown"
    ' <<<"$task_json")"
    echo "::error::$label task failed (exit=$exit_code, stopped=$stopped_reason, container=$container_reason)."
    return 1
  fi
  echo "$label completed successfully"
}

rollback_service() {
  echo "::warning::Rolling $APP back to $current_task_definition."
  if ! aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$APP" \
    --task-definition "$current_task_definition" \
    --desired-count "$service_desired_count" \
    --deployment-configuration '{
      "deploymentCircuitBreaker": {"enable": true, "rollback": true},
      "minimumHealthyPercent": 100,
      "maximumPercent": 200
    }' \
    >/dev/null; then
    echo "::error::ECS rejected the rollback to $current_task_definition."
    return 1
  fi
  wait_for_service_rollout "$current_task_definition" "rollback"
}

internal_metrics_secret_arn=""
if [[ -n "$INTERNAL_METRICS_PARAMETER" ]]; then
  if [[ "$INTERNAL_METRICS_PARAMETER" == arn:* ]]; then
    internal_metrics_secret_arn="$INTERNAL_METRICS_PARAMETER"
  else
    if [[ ! "$AWS_ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
      echo "::error::AWS_ACCOUNT_ID must be a 12-digit account id when INTERNAL_METRICS_PARAMETER is a parameter name."
      exit 1
    fi
    # The hyphen is LAST on purpose. This is a POSIX bracket expression, where a
    # backslash is an ordinary character rather than an escape, so the `\-/` that
    # reads as an escaped hyphen in PCRE is really a reversed `\`-to-`/` range and
    # the class then matches no hyphen at all. Every `/oxy/<app>/...` parameter
    # path whose app name contains one was silently rejected.
    if [[ ! "$AWS_PARTITION" =~ ^aws(-[a-z]+)?$ ||
          ! "$INTERNAL_METRICS_PARAMETER" =~ ^/[A-Za-z0-9_./-]+$ ]]; then
      echo "::error::AWS partition or INTERNAL_METRICS_PARAMETER name is invalid."
      exit 1
    fi
    internal_metrics_secret_arn="arn:${AWS_PARTITION}:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${INTERNAL_METRICS_PARAMETER#/}"
  fi
  if [[ ! "$internal_metrics_secret_arn" =~ ^arn:aws(-[a-z]+)?:ssm:[a-z0-9-]+:[0-9]{12}:parameter/.+$ ]]; then
    echo "::error::Unable to construct a valid SSM parameter ARN for the task definition."
    exit 1
  fi
fi

task_secret_overrides="$(jq -c '
  [
    to_entries[]
    | {name: .key, valueFrom: .value}
  ]
' <<<"$TASK_SECRET_OVERRIDES_JSON")"
task_environment_overrides="$(jq -c '
  [
    to_entries[]
    | {name: .key, value: .value}
  ]
' <<<"$TASK_ENV_OVERRIDES_JSON")"

aws ecs describe-task-definition \
  --task-definition "$current_task_definition" \
  --query taskDefinition \
  >"$task_definition_file"

container_matches="$(jq --arg name "$CONTAINER_NAME" '[.containerDefinitions[] | select(.name == $name)] | length' "$task_definition_file")"
if [[ "$container_matches" != "1" ]]; then
  available_containers="$(jq -r '[.containerDefinitions[].name] | join(", ")' "$task_definition_file")"
  echo "::error::Expected exactly one container named $CONTAINER_NAME; found $container_matches. Available: $available_containers"
  exit 1
fi

jq \
  --arg name "$CONTAINER_NAME" \
  --arg image "$IMAGE_URI" \
  --arg internalMetricsSecretArn "$internal_metrics_secret_arn" \
  --argjson taskEnvironmentOverrides "$task_environment_overrides" \
  --argjson taskSecretOverrides "$task_secret_overrides" \
  --argjson taskConfigurationRemovals "$TASK_CONFIGURATION_REMOVALS_JSON" \
  '
    del(
      .taskDefinitionArn,
      .revision,
      .status,
      .requiresAttributes,
      .compatibilities,
      .registeredAt,
      .registeredBy
    )
    | ($taskEnvironmentOverrides | map(.name)) as $taskEnvironmentNames
    | ($taskSecretOverrides | map(.name)) as $taskSecretNames
    | .containerDefinitions |= map(
        if .name == $name then
          .image = $image
          | if $internalMetricsSecretArn != "" then
              .secrets = (
                (.secrets // [])
                | map(select(.name != "INTERNAL_METRICS_TOKEN"))
                + [{
                    name: "INTERNAL_METRICS_TOKEN",
                    valueFrom: $internalMetricsSecretArn
                  }]
              )
              | .environment = (
                  (.environment // [])
                  | map(select(.name != "INTERNAL_METRICS_ENABLED"))
                  + [{name: "INTERNAL_METRICS_ENABLED", value: "true"}]
                )
            else .
            end
          | .secrets = (
              ((.secrets // [])
                | map(
                    select(
                      .name as $existingName
                      | ($taskSecretNames | index($existingName)) == null and
                        ($taskEnvironmentNames | index($existingName)) == null and
                        ($taskConfigurationRemovals | index($existingName)) == null
                    )
                  ))
              + $taskSecretOverrides
            )
          | .environment = (
              ((.environment // [])
                | map(
                    select(
                      .name as $existingName
                      | ($taskEnvironmentNames | index($existingName)) == null and
                        ($taskSecretNames | index($existingName)) == null and
                        ($taskConfigurationRemovals | index($existingName)) == null
                    )
                  ))
              + $taskEnvironmentOverrides
            )
        else . end
      )
  ' \
  "$task_definition_file" >"$rendered_task_definition_file"

new_task_definition="$(aws ecs register-task-definition \
  --cli-input-json "file://$rendered_task_definition_file" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)"

one_shot_run_task_args=()
if [[ "$migrations_run_in_this_lane" == "true" || -n "$POST_DEPLOY_TASK_COMMAND_JSON" ]]; then
  network_configuration="$(jq -c '.services[0].networkConfiguration' <<<"$service_json")"
  if [[ -z "$network_configuration" || "$network_configuration" == "null" ]]; then
    echo "::error::ECS service $APP has no network configuration for the migration task."
    exit 1
  fi

  one_shot_run_task_args=(
    ecs run-task
    --cluster "$CLUSTER"
    --task-definition "$new_task_definition"
    --count 1
    --network-configuration "$network_configuration"
  )

  capacity_provider_strategy="$(jq -c '.services[0].capacityProviderStrategy // []' <<<"$service_json")"
  if [[ "$capacity_provider_strategy" != "[]" ]]; then
    one_shot_run_task_args+=(--capacity-provider-strategy "$capacity_provider_strategy")
  else
    launch_type="$(jq -r '.services[0].launchType // "FARGATE"' <<<"$service_json")"
    one_shot_run_task_args+=(--launch-type "$launch_type")
    platform_version="$(jq -r '.services[0].platformVersion // empty' <<<"$service_json")"
    if [[ -n "$platform_version" ]]; then
      one_shot_run_task_args+=(--platform-version "$platform_version")
    fi
  fi
fi

if [[ "$migrations_run_in_this_lane" == "true" ]]; then
  # PROCESS SUBSTITUTION, NOT A PIPE, and the reason is not the obvious one.
  #
  # `set -e` catches the failing pipeline either way, so both forms do stop the
  # release before `update-service` — so do not "simplify" this on the theory
  # that the pipe is equivalent. What a pipe loses is the loop body's WRITES: it
  # runs in a subshell, so `run_one_shot_command`'s `active_one_shot_task_arn` /
  # `_label` / `_stopped` never reach the parent, and the EXIT trap reads their
  # initial values. The warning that a migration task may STILL BE RUNNING
  # against the database after the deploy gave up — the one thing telling an
  # operator the schema may be moving under them, and unrecoverable because the
  # deploy role cannot call `ecs:StopTask` — silently stops being emitted. The
  # `migration-task-never-stops` case in test-deploy-ecs-image.sh is what
  # notices.
  while IFS= read -r migration_entry; do
    if ! run_one_shot_command \
      "$(jq -r '.label' <<<"$migration_entry")" \
      "$(jq -c '.command' <<<"$migration_entry")"; then
      exit 1
    fi
  done < <(jq -c '.[]' <<<"$MIGRATION_TASK_COMMANDS_JSON")
fi

if [[ -n "${DEPLOY_SHA:-}" ]]; then
  echo "Re-verifying origin/main immediately before the ECS service update."
  bash "$DEPLOY_HEAD_GUARD_SCRIPT"
fi

if ! aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$APP" \
  --task-definition "$new_task_definition" \
  --desired-count "$service_desired_count" \
  --deployment-configuration '{
    "deploymentCircuitBreaker": {"enable": true, "rollback": true},
    "minimumHealthyPercent": 100,
    "maximumPercent": 200
  }' \
  >/dev/null; then
  echo "::error::ECS rejected the service update; restoring the previous task definition defensively."
  # At zero capacity there is nothing to restore TO: no task is running, so the
  # "previous image" is not serving either, and rollback_service would sit in
  # wait_for_service_rollout until MAX_WAIT_SECS waiting for a steady state that
  # cannot arrive. Say that instead of spending twenty minutes proving it.
  if [[ "$zero_capacity_deploy" == "true" ]]; then
    echo "::error::$APP is at desiredCount=0, so no rollback was attempted: nothing is running to roll back from, and the service is still pointed at $current_task_definition."
    exit 1
  fi
  if ! rollback_service; then
    echo "::error::The defensive rollback also failed; manual intervention is required."
  fi
  exit 1
fi

# The ROLLOUT is the only thing here that would be a lie, so it is the only
# thing skipped: a rollout at desiredCount 0 reaches "COMPLETED" with zero
# running tasks, which is exactly the plausible-looking green this estate keeps
# getting caught by. The post-deploy one-shot is neither a lie nor optional.
#
# It runs as its OWN ECS task — run_one_shot_command calls `ecs run-task`, not
# the service — so the service's capacity has nothing to do with it. The
# pre-rollout run above is the positive control: it launches and succeeds at
# this same desiredCount=0, by the same mechanism, on the same revision.
#
# And zero capacity is the one condition under which `post` is unconditionally
# SAFE. A `post` statement is defined as one that breaks a write the previous
# image performs; with zero tasks running there is no previous image, and no
# such write. The rule that defers it has no subject here.
#
# Deferring it anyway DEADLOCKS the service. @oxyhq/db records migration
# progress as a high-water mark and cannot skip a hole (see planMigrationRun in
# its migrate/phases), so the NEXT release's `pre` run is BLOCKED behind the
# unapplied `post` one and that deploy fails at its migration step — before ever
# reaching the post-deploy task that was supposed to catch up. So "it applies on
# the first deploy after the service is scaled up" is FALSE: every deploy in
# between fails, and a human has to clear it with a `--phase=all` one-shot.
# Measured in alia, which sat parked at zero: four consecutive merges deployed
# red behind an unapplied 0016 while every one of their PRs was green.
if [[ "$zero_capacity_deploy" == "true" ]]; then
  if [[ -n "$POST_DEPLOY_SMOKE_SCRIPT" ]]; then
    # Skipped, and named rather than silently omitted. Every smoke script in
    # this estate asserts HTTP against the service's own public origin, so with
    # zero running tasks it can only fail on a target group with no healthy
    # member, or "pass" against something in front that is not this image.
    # Neither outcome measures the release, and a rollback over either is
    # meaningless when nothing is serving.
    echo "::warning::NO ROLLOUT PERFORMED: post-deploy smoke checks were SKIPPED ($POST_DEPLOY_SMOKE_SCRIPT). With zero running tasks they cannot reach this image, so they could only fail or mislead."
  fi

  if [[ -n "$POST_DEPLOY_TASK_COMMAND_JSON" ]]; then
    if ! run_one_shot_command \
      "Post-deploy reconciliation" \
      "$POST_DEPLOY_TASK_COMMAND_JSON"; then
      # No rollback, for the same reason update-service does not roll back here:
      # nothing is running to roll back FROM, and rollback_service would sit in
      # wait_for_service_rollout until MAX_WAIT_SECS waiting for a steady state
      # that cannot arrive.
      echo "::error::Post-deploy reconciliation failed at desiredCount=0. $APP is left pointed at $new_task_definition with the post phase UNAPPLIED, and no rollback was attempted because nothing is running to roll back from. Resolve it before the next deploy: a later pre-phase migration queued behind an unapplied post one is refused, which fails that deploy at its migration step."
      exit 1
    fi
  fi

  echo "::warning::NO ROLLOUT PERFORMED: ECS service $APP is at desiredCount=0 and is running ZERO tasks."
  echo "::warning::NO ROLLOUT PERFORMED: the task definition WAS registered and the service now points at it: $new_task_definition"
  echo "::warning::NO ROLLOUT PERFORMED: image $IMAGE_URI is NOT live and $APP is serving NOTHING. This deploy released nothing to users."
  # Which phases ran, stated rather than implied. A reader of this log has to be
  # able to tell a schema that is fully migrated from one that is half migrated,
  # and "NO ROLLOUT PERFORMED" is silent about both.
  if [[ "$RUN_MIGRATIONS" == "true" ]] && [[ -n "$POST_DEPLOY_TASK_COMMAND_JSON" ]]; then
    echo "::warning::NO ROLLOUT PERFORMED: MIGRATIONS DID RUN — the pre-rollout migrations ran before the repoint and the post-deploy one-shot after it. The schema is fully migrated; only the rollout was skipped."
  elif [[ "$RUN_MIGRATIONS" == "true" ]]; then
    echo "::warning::NO ROLLOUT PERFORMED: MIGRATIONS DID RUN — the pre-rollout migrations ran before the repoint. This release carries no post-deploy one-shot."
  fi
  echo "::warning::NO ROLLOUT PERFORMED: to run this image, raise desired_count in oxy-infra terraform and deploy again."
  exit 0
fi

echo "Deploying immutable image $IMAGE_URI with task definition $new_task_definition"

if ! wait_for_service_rollout "$new_task_definition" "deployment"; then
  if ! rollback_service; then
    echo "::error::Deployment and explicit rollback both failed; manual intervention is required."
  fi
  exit 1
fi
echo "ECS rollout reached a healthy steady state at $new_task_definition"

if [[ -n "$POST_DEPLOY_SMOKE_SCRIPT" ]]; then
  echo "Running post-deploy smoke checks with $POST_DEPLOY_SMOKE_SCRIPT"
  smoke_exit=0
  bash "$POST_DEPLOY_SMOKE_SCRIPT" || smoke_exit=$?
  if (( smoke_exit == SMOKE_NO_ROLLBACK_EXIT )); then
    # The smoke script attributed every failure to something outside the image.
    # The release keeps going — including the reconciliation task below, which
    # would otherwise be skipped over a fault it has nothing to do with — and the
    # job fails at the end so the failure is still paged rather than swallowed.
    echo "::error::Post-deploy smoke checks failed only checks that a rollback cannot repair. $APP stays on $new_task_definition; investigate the dependency named above."
    smoke_reported_external_failure=true
  elif (( smoke_exit != 0 )); then
    echo "::error::Post-deploy smoke checks failed."
    if rollback_service; then
      echo "::warning::Rollback completed after smoke failure."
    else
      echo "::error::Rollback also failed; manual intervention is required."
    fi
    exit 1
  fi
fi

if [[ -n "$POST_DEPLOY_TASK_COMMAND_JSON" ]]; then
  # Labelled for what the hook IS rather than for one thing a caller might put
  # in it. Homiio's worker lane puts the `post` migration phase here, and a line
  # reading "Post-deploy reconciliation failed" for a failed migration is the
  # kind of operator-facing string that misleads at the worst possible moment.
  if ! run_one_shot_command \
    "Post-deploy task" \
    "$POST_DEPLOY_TASK_COMMAND_JSON"; then
    echo "::error::The post-deploy task failed."
    if ! rollback_service; then
      echo "::error::Reconciliation and rollback both failed; manual intervention is required."
    fi
    exit 1
  fi
fi

if [[ "$smoke_reported_external_failure" == "true" ]]; then
  echo "::error::$APP is deployed and live at $new_task_definition, but its post-deploy smoke checks are still failing on a dependency. Nothing was rolled back; this release needs a human."
  exit 1
fi

echo "Deployed $APP at $new_task_definition"
