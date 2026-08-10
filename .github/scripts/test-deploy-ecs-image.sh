#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_directory="$(mktemp -d)"
temporary_root="$(realpath "${TMPDIR:-/tmp}")"
test_directory="$(realpath "$test_directory")"

cleanup_test_directory() {
  if [[ "$test_directory" == "$temporary_root/"* &&
        -d "$test_directory" ]]; then
    rm -rf -- "$test_directory"
  else
    echo "Refusing to remove unexpected test directory: $test_directory" >&2
  fi
}
trap cleanup_test_directory EXIT

export DEPLOY_TEST_LOG=""
export DEPLOY_TEST_EXPECT_METRICS_ARN=false
# The SSM parameter path a case feeds to INTERNAL_METRICS_PARAMETER, and from
# which the mocked register-task-definition derives the ARN it demands. A case
# overrides it to cover a path shape the default does not.
export DEPLOY_TEST_METRICS_PARAMETER=/oxy/sampleapp/INTERNAL_METRICS_TOKEN
export DEPLOY_TEST_TASK_EXIT_CODE=0
export DEPLOY_TEST_EXPECT_TASK_SECRET_ARN=false
export DEPLOY_TEST_SERVICE_DESIRED_COUNT=1
export DEPLOY_TEST_ROLLOUT_SCENARIO=healthy
# `lastStatus` the mocked describe-tasks reports. Only the never-stops case moves
# it, and it is what reaches the EXIT trap's unfinished-task warning.
export DEPLOY_TEST_TASK_LAST_STATUS=STOPPED

# Vacuity floor. Without it this suite's only output on success is one line, so a
# traversal that silently stopped after two cases is indistinguishable from a
# full green run -- and every guarantee below would read as verified while never
# having executed. Incremented by run_release, checked at the very end.
cases_run=0
# 24 -> 18: the six ALLOW_ZERO_DESIRED_COUNT cases and the standalone zero-count
# REFUSAL case went with the opt-in they tested, replaced by one `zero-desired-count`
# case asserting the release lands. Lower this ONLY alongside a deletion you can
# name; a floor quietly reduced to match whatever ran is not a floor.
MINIMUM_CASES=18

aws() {
  local service_json='{
    "failures": [],
    "services": [{
      "status": "ACTIVE",
      "taskDefinition": "arn:aws:ecs:test:task-definition/deploy-test:1",
      "desiredCount": 1,
      "networkConfiguration": {
        "awsvpcConfiguration": {
          "subnets": ["subnet-test"],
          "securityGroups": ["sg-test"]
        }
      },
      "launchType": "FARGATE",
      "deployments": [
        {
          "taskDefinition": "arn:aws:ecs:test:task-definition/deploy-test:2",
          "status": "PRIMARY",
          "rolloutState": "COMPLETED",
          "runningCount": 1,
          "desiredCount": 1
        },
        {
          "taskDefinition": "arn:aws:ecs:test:task-definition/deploy-test:1",
          "status": "PRIMARY",
          "rolloutState": "COMPLETED",
          "runningCount": 1,
          "desiredCount": 1
        }
      ]
    }]
  }'
  service_json="$(jq \
    --argjson desired "$DEPLOY_TEST_SERVICE_DESIRED_COUNT" \
    '.services[0].desiredCount = $desired' \
    <<<"$service_json")"

  case "$1 $2" in
    "ecs describe-services")
      local describe_count_file="${DEPLOY_TEST_LOG}.describe-count"
      local describe_count=0
      if [[ -f "$describe_count_file" ]]; then
        describe_count="$(<"$describe_count_file")"
      fi
      describe_count=$((describe_count + 1))
      printf '%s\n' "$describe_count" >"$describe_count_file"
      if [[ "$DEPLOY_TEST_ROLLOUT_SCENARIO" == "transient-zero-deployment" &&
            "$describe_count" == "2" ]]; then
        service_json="$(jq '
          .services[0].deployments |= map(
              if .taskDefinition == "arn:aws:ecs:test:task-definition/deploy-test:2"
              then
                .rolloutState = "IN_PROGRESS"
                | .desiredCount = 0
                | .runningCount = 0
              else .
              end
            )
        ' <<<"$service_json")"
      elif [[ "$DEPLOY_TEST_ROLLOUT_SCENARIO" == "zero-service-during-deploy" &&
              "$describe_count" == "2" ]]; then
        service_json="$(jq '
          .services[0].desiredCount = 0
          | .services[0].deployments |= map(
              if .taskDefinition == "arn:aws:ecs:test:task-definition/deploy-test:2"
              then .desiredCount = 0 | .runningCount = 0
              else .
              end
            )
        ' <<<"$service_json")"
      elif [[ "$DEPLOY_TEST_ROLLOUT_SCENARIO" == "completed-zero-deployment" &&
              "$describe_count" == "2" ]]; then
        service_json="$(jq '
          .services[0].deployments |= map(
              if .taskDefinition == "arn:aws:ecs:test:task-definition/deploy-test:2"
              then .desiredCount = 0 | .runningCount = 0
              else .
              end
            )
        ' <<<"$service_json")"
      fi
      printf '%s\n' "$service_json"
      ;;
    "ecs describe-task-definition")
      printf '%s\n' '{
        "family": "deploy-test",
        "networkMode": "awsvpc",
        "requiresCompatibilities": ["FARGATE"],
        "cpu": "256",
        "memory": "512",
        "containerDefinitions": [{
          "name": "deploy-test",
          "image": "example.invalid/deploy-test:old",
          "essential": true,
          "logConfiguration": {
            "logDriver": "awslogs",
            "options": {
              "awslogs-group": "/ecs/deploy-test",
              "awslogs-stream-prefix": "ecs"
            }
          }
        }]
      }'
      ;;
    "ecs register-task-definition")
      if [[ "$DEPLOY_TEST_EXPECT_METRICS_ARN" == "true" ]]; then
        local previous_argument=""
        local input_json=""
        local argument
        for argument in "$@"; do
          if [[ "$previous_argument" == "--cli-input-json" ]]; then
            input_json="${argument#file://}"
            break
          fi
          previous_argument="$argument"
        done
        # The verdict is written to the log rather than left to `set -e`. A
        # command that fails in the MIDDLE of this function does not abort the
        # run -- measured, and it holds whether the function is exported or
        # local -- because the caller consumes it as `v="$(aws ...)"` and only
        # the function's LAST command reaches that assignment's exit status. An
        # assertion whose only effect is its own exit status therefore cannot
        # fail, which is what this one did: pointing it at an ARN no case uses
        # left the suite green. Logging a distinct token instead puts the
        # mismatch in the expected.log diff, where it names itself.
        if jq -e \
          --arg expected \
          "arn:aws:ssm:test:123456789012:parameter${DEPLOY_TEST_METRICS_PARAMETER}" \
          '
          .containerDefinitions[]
          | select(.name == "deploy-test")
          | .secrets[]
          | select(
              .name == "INTERNAL_METRICS_TOKEN" and
              .valueFrom == $expected
            )
        ' "$input_json" >/dev/null; then
          printf 'metrics:arn\n' >>"$DEPLOY_TEST_LOG"
        else
          printf 'metrics:arn:MISMATCH\n' >>"$DEPLOY_TEST_LOG"
        fi
      fi
      if [[ "$DEPLOY_TEST_EXPECT_TASK_SECRET_ARN" == "true" ]]; then
        local previous_argument=""
        local input_json=""
        local argument
        for argument in "$@"; do
          if [[ "$previous_argument" == "--cli-input-json" ]]; then
            input_json="${argument#file://}"
            break
          fi
          previous_argument="$argument"
        done
        # Same reason as the metrics assertion above: log the verdict, do not
        # rely on this function's exit status.
        if jq -e '
          .containerDefinitions[]
          | select(.name == "deploy-test")
          | .secrets[]
          | select(
              .name == "EXTRA_TASK_SECRET" and
              .valueFrom == "arn:aws:ssm:test:123456789012:parameter/oxy/sample-app/EXTRA_TASK_SECRET"
            )
        ' "$input_json" >/dev/null; then
          printf 'task-secret:arn\n' >>"$DEPLOY_TEST_LOG"
        else
          printf 'task-secret:arn:MISMATCH\n' >>"$DEPLOY_TEST_LOG"
        fi
      fi
      printf '%s\n' "arn:aws:ecs:test:task-definition/deploy-test:2"
      ;;
    "ecs update-service")
      local previous_argument=""
      local task_definition=""
      local desired_count=""
      local argument
      for argument in "$@"; do
        if [[ "$previous_argument" == "--task-definition" ]]; then
          task_definition="$argument"
        elif [[ "$previous_argument" == "--desired-count" ]]; then
          desired_count="$argument"
        fi
        previous_argument="$argument"
      done
      if [[ -z "$desired_count" ]]; then
        echo "Mocked update-service requires an explicit --desired-count." >&2
        return 1
      fi
      printf 'service:%s:desired=%s\n' \
        "$task_definition" \
        "$desired_count" \
        >>"$DEPLOY_TEST_LOG"
      printf '{}\n'
      ;;
    "ecs run-task")
      # Log the command this one-shot was actually given, not a fixed token. The
      # release runs several one-shots (each migration, then the reconciliation
      # task) through the SAME call, so a mock that logged a constant could not
      # tell them apart -- it recorded a migration task as "reconcile" and was
      # blind to their ORDER, which is the one property worth asserting here.
      local overrides="" take_next=false argument
      for argument in "$@"; do
        if [[ "$take_next" == "true" ]]; then
          overrides="$argument"
          take_next=false
          continue
        fi
        if [[ "$argument" == "--overrides" ]]; then
          take_next=true
        fi
      done
      if [[ -z "$overrides" ]]; then
        echo "Mocked run-task received no --overrides." >&2
        return 1
      fi
      printf 'task:%s\n' \
        "$(jq -r '.containerOverrides[0].command | join(" ")' <<<"$overrides")" \
        >>"$DEPLOY_TEST_LOG"
      printf '%s\n' '{
        "failures": [],
        "tasks": [{"taskArn": "arn:aws:ecs:test:task/deploy-test-one-shot"}]
      }'
      ;;
    "ecs describe-tasks")
      printf '{
        "failures": [],
        "tasks": [{
          "lastStatus": "%s",
          "stoppedReason": "Essential container exited",
          "containers": [{
            "name": "deploy-test",
            "exitCode": %s
          }]
        }]
      }\n' "$DEPLOY_TEST_TASK_LAST_STATUS" "$DEPLOY_TEST_TASK_EXIT_CODE"
      ;;
    "logs get-log-events")
      printf 'tasklogs\n' >>"$DEPLOY_TEST_LOG"
      printf '%s\n' '{
        "events": [{
          "message": "[migration] fixture failure"
        }]
      }'
      ;;
    *)
      printf 'Unexpected mocked AWS call: %s\n' "$*" >&2
      return 1
      ;;
  esac
}
export -f aws

run_release() {
  local case_name="$1"
  local expect_success="$2"
  local run_migrations="${3:-false}"
  local inject_internal_metrics="${4:-false}"
  local task_exit_code="${5:-0}"
  local inject_task_secret="${6:-false}"
  local service_desired_count="${7:-1}"
  local rollout_scenario="${8:-healthy}"
  local smoke_exit_code="${9:-0}"
  local case_directory="$test_directory/$case_name"
  local output_file="$case_directory/output.log"
  local smoke_script="$case_directory/smoke.sh"

  # What this case hands the post-deploy hook. An env override rather than a
  # tenth positional, which nobody could read at a call site. `none` means the
  # lane sets NO post-deploy task — the real API lane's shape, and distinct from
  # "unset", which keeps the historical `reconcile` fixture every older case
  # below expects.
  local post_deploy_command
  case "${DEPLOY_TEST_POST_DEPLOY_TASK_COMMAND_JSON:-}" in
    '') post_deploy_command='["reconcile"]' ;;
    none) post_deploy_command='' ;;
    *) post_deploy_command="$DEPLOY_TEST_POST_DEPLOY_TASK_COMMAND_JSON" ;;
  esac

  cases_run=$((cases_run + 1))
  mkdir -p "$case_directory"
  DEPLOY_TEST_LOG="$case_directory/aws.log"
  DEPLOY_TEST_EXPECT_METRICS_ARN="$inject_internal_metrics"
  DEPLOY_TEST_TASK_EXIT_CODE="$task_exit_code"
  DEPLOY_TEST_EXPECT_TASK_SECRET_ARN="$inject_task_secret"
  DEPLOY_TEST_SERVICE_DESIRED_COUNT="$service_desired_count"
  DEPLOY_TEST_ROLLOUT_SCENARIO="$rollout_scenario"
  export DEPLOY_TEST_LOG DEPLOY_TEST_EXPECT_METRICS_ARN
  export DEPLOY_TEST_TASK_EXIT_CODE
  export DEPLOY_TEST_EXPECT_TASK_SECRET_ARN
  export DEPLOY_TEST_SERVICE_DESIRED_COUNT
  export DEPLOY_TEST_ROLLOUT_SCENARIO
  export DEPLOY_TEST_TASK_LAST_STATUS

  # The generated smoke fixture expands DEPLOY_TEST_LOG when it runs; its exit
  # code is the entire interface deploy-ecs-image.sh reads, so each case picks
  # one. 75 is the "failed, but a rollback cannot repair it" code.
  # shellcheck disable=SC2016
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'printf "smoke\n" >>"$DEPLOY_TEST_LOG"' \
    "exit $smoke_exit_code" \
    >"$smoke_script"

  local -a release_environment=(
    AWS_REGION=test
    AWS_ACCOUNT_ID=123456789012
    CLUSTER=deploy-test
    # APP names the ECS SERVICE. It is overridable because the worker-lane case
    # turns on APP differing from MIGRATION_SERVICE, while CONTAINER_NAME stays
    # `deploy-test` to keep matching the container in the mocked task definition.
    APP="${DEPLOY_TEST_APP:-deploy-test}"
    CONTAINER_NAME=deploy-test
    MIGRATION_SERVICE="${DEPLOY_TEST_MIGRATION_SERVICE:-}"
    IMAGE_URI="example.invalid/deploy-test@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    MAX_WAIT_SECS=5
    POLL_INTERVAL=1
    RUN_MIGRATIONS="$run_migrations"
    POST_DEPLOY_SMOKE_SCRIPT="$smoke_script"
    POST_DEPLOY_TASK_COMMAND_JSON="$post_deploy_command"
  )
  if [[ "$inject_internal_metrics" == "true" ]]; then
    release_environment+=(
      INTERNAL_METRICS_PARAMETER="$DEPLOY_TEST_METRICS_PARAMETER"
    )
  fi
  if [[ "$inject_task_secret" == "true" ]]; then
    release_environment+=(
      TASK_SECRET_OVERRIDES_JSON='{"EXTRA_TASK_SECRET":"arn:aws:ssm:test:123456789012:parameter/oxy/sample-app/EXTRA_TASK_SECRET"}'
    )
  fi

  if env "${release_environment[@]}" \
    bash "$repository_root/.github/scripts/deploy-ecs-image.sh" \
    >"$output_file" 2>&1; then
    if [[ "$expect_success" != "true" ]]; then
      echo "Expected $case_name to fail." >&2
      return 1
    fi
  elif [[ "$expect_success" == "true" ]]; then
    echo "Expected $case_name to succeed." >&2
    sed -n '1,240p' "$output_file" >&2
    return 1
  fi
}

# Assert a case's captured output contains a fixed string, and NAME the case, the
# string, and the actual output when it does not.
#
# A bare `grep -F needle file` under `set -e` fails this suite with ZERO output
# on either stream: the exit status is the entire signal, so an empty match is
# indistinguishable from a pass to anyone reading the log, and from a crash to
# anyone reading the exit code. Measured while mutation-testing this file — a
# mutation was correctly caught and printed nothing whatsoever, naming neither
# the case nor the guarantee it broke. Every output assertion goes through here
# so that a red run says what it wanted and what it got.
assert_output_contains() {
  local case_name="$1" needle="$2"
  if ! grep -qF -- "$needle" "$test_directory/$case_name/output.log"; then
    {
      echo "ASSERTION FAILED in case '$case_name'"
      echo "  expected the deploy output to CONTAIN:"
      echo "    $needle"
      echo "  ---- actual output ----"
      sed -n '1,80p' "$test_directory/$case_name/output.log"
      echo "  ---- end ----"
    } >&2
    return 1
  fi
}

# The negative form. Same reasoning: say which case, and which string must not
# have appeared.
assert_output_lacks() {
  local case_name="$1" needle="$2" why="$3"
  if grep -qF -- "$needle" "$test_directory/$case_name/output.log"; then
    {
      echo "ASSERTION FAILED in case '$case_name'"
      echo "  the deploy output must NOT contain:"
      echo "    $needle"
      echo "  why: $why"
    } >&2
    return 1
  fi
}

# The recorded AWS calls must not mention a string. Used to prove a refusal
# happened BEFORE anything mutating, and that a lane ran no migrator.
assert_aws_log_contains() {
  local case_name="$1" needle="$2" why="$3"
  if ! grep -qF -- "$needle" "$test_directory/$case_name/aws.log"; then
    {
      echo "ASSERTION FAILED in case '$case_name'"
      echo "  the recorded AWS calls must contain: $needle"
      echo "  why: $why"
      echo "  ---- recorded AWS calls ----"
      cat "$test_directory/$case_name/aws.log"
      echo "  ---- end ----"
    } >&2
    return 1
  fi
}

assert_aws_log_lacks() {
  local case_name="$1" needle="$2" why="$3"
  if grep -qF -- "$needle" "$test_directory/$case_name/aws.log"; then
    {
      echo "ASSERTION FAILED in case '$case_name'"
      echo "  the recorded AWS calls must NOT contain: $needle"
      echo "  why: $why"
      echo "  ---- recorded AWS calls ----"
      cat "$test_directory/$case_name/aws.log"
      echo "  ---- end ----"
    } >&2
    return 1
  fi
}

# The anchored-pattern form of the above. Separate from the fixed-string helper
# because the anchor is the assertion in these cases: `^service:` must mean a
# recorded update-service line, not the substring appearing inside a command.
assert_aws_log_lacks_pattern() {
  local case_name="$1" pattern="$2" why="$3"
  if grep -qE -- "$pattern" "$test_directory/$case_name/aws.log"; then
    {
      echo "ASSERTION FAILED in case '$case_name'"
      echo "  the recorded AWS calls must NOT match: $pattern"
      echo "  why: $why"
      echo "  ---- recorded AWS calls ----"
      cat "$test_directory/$case_name/aws.log"
      echo "  ---- end ----"
    } >&2
    return 1
  fi
}

# No mutating AWS call may have been made at all.
assert_no_aws_calls() {
  local case_name="$1" why="$2"
  if [[ -s "$test_directory/$case_name/aws.log" ]]; then
    {
      echo "ASSERTION FAILED in case '$case_name'"
      echo "  expected NO mutating AWS call; the refusal must land first."
      echo "  why: $why"
      echo "  ---- recorded AWS calls ----"
      cat "$test_directory/$case_name/aws.log"
      echo "  ---- end ----"
    } >&2
    return 1
  fi
}

run_release success true false true
printf '%s\n' \
  metrics:arn \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  smoke \
  task:reconcile \
  >"$test_directory/success/expected.log"
diff -u \
  "$test_directory/success/expected.log" \
  "$test_directory/success/aws.log"

# A hyphen in the parameter path is its own case because it is its own bug: the
# bracket expression validating this name once matched every character EXCEPT a
# hyphen, so an app whose path had none deployed and an app whose path had one
# did not -- and the only repo with a smoke fixture at the time was one of the
# former, which is why nothing here caught it.
#
# KEEP BOTH, and keep the plain one's app segment hyphen-FREE. That asymmetry is
# the entire test: rename them to two spellings that both contain a hyphen and
# this pair silently stops discriminating, while the suite still passes and still
# goes red under a mutation -- just for the wrong case.
DEPLOY_TEST_METRICS_PARAMETER=/oxy/sample-app/INTERNAL_METRICS_TOKEN
run_release hyphenated-metrics-parameter true false true
DEPLOY_TEST_METRICS_PARAMETER=/oxy/sampleapp/INTERNAL_METRICS_TOKEN
printf '%s\n' \
  metrics:arn \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  smoke \
  task:reconcile \
  >"$test_directory/hyphenated-metrics-parameter/expected.log"
diff -u \
  "$test_directory/hyphenated-metrics-parameter/expected.log" \
  "$test_directory/hyphenated-metrics-parameter/aws.log"

run_release explicit-task-secret true false false 0 true
printf '%s\n' \
  task-secret:arn \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  smoke \
  task:reconcile \
  >"$test_directory/explicit-task-secret/expected.log"
diff -u \
  "$test_directory/explicit-task-secret/expected.log" \
  "$test_directory/explicit-task-secret/aws.log"

run_release reconciliation-failure false false false 1
printf '%s\n' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  smoke \
  task:reconcile \
  tasklogs \
  'service:arn:aws:ecs:test:task-definition/deploy-test:1:desired=1' \
  >"$test_directory/reconciliation-failure/expected.log"
diff -u \
  "$test_directory/reconciliation-failure/expected.log" \
  "$test_directory/reconciliation-failure/aws.log"

# A migration one-shot that exits non-zero stops the release. The task run is the
# Postgres migrator -- previously this case expected a bare "reconcile" here,
# because the mock could not tell a migration task from the reconciliation task
# and so recorded the wrong one by name.
run_release migration-failure false true false 1
printf '%s\n' \
  'task:node packages/backend/dist/db/migrate.js --target-database=homiio --phase=pre' \
  tasklogs \
  >"$test_directory/migration-failure/expected.log"
diff -u \
  "$test_directory/migration-failure/expected.log" \
  "$test_directory/migration-failure/aws.log"
assert_output_contains migration-failure "[migration] fixture failure"
assert_aws_log_lacks_pattern migration-failure '^service:' "Failed migration reached update-service."
# The path this replaced -- `bun packages/backend/dist/scripts/migrate.js` -- was
# wrong three ways at once, and the last one is why nothing noticed: `bun` is not
# in the runtime image (it runs `node`), `tsconfig.build.json` EXCLUDES
# `scripts/` from the emit, and no `scripts/migrate.ts` has ever existed here. So
# `RUN_MIGRATIONS=true` had never once worked in this repository. Asserting the
# absence of the old path keeps a future edit from reintroducing either half.
assert_aws_log_lacks migration-failure "dist/scripts/migrate.js" "The migration one-shot ran the nonexistent scripts/migrate.js path."
assert_aws_log_lacks_pattern migration-failure '^task:bun ' "The migration one-shot invoked bun; the runtime image only has node."

# ORDER IS THE ASSERTION: the migration one-shot runs BEFORE `update-service`.
#
# A task that boots against an unmigrated database answers the health check, is
# handed traffic, and only then fails every query -- the damage lands after the
# point of no return. A whole-log `diff` is what notices a reordering; grepping
# for both entries would pass either way round.
run_release migration-order true true false 0
printf '%s\n' \
  'task:node packages/backend/dist/db/migrate.js --target-database=homiio --phase=pre' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  smoke \
  task:reconcile \
  >"$test_directory/migration-order/expected.log"
diff -u \
  "$test_directory/migration-order/expected.log" \
  "$test_directory/migration-order/aws.log"

# THE WORKER LANE GETS NO MIGRATION ONE-SHOT.
#
# Both Homiio services roll the SAME image through this script, and
# `db/migrate.ts` takes no cross-process advisory lock (neither does drizzle), so
# the migrator must run exactly once per release. `MIGRATION_SERVICE` names the
# lane that owns it; the worker lane sees the same `RUN_MIGRATIONS=true` and must
# still decline.
#
# It SKIPS rather than refuses, and that is asserted too: the API lane rolls
# first, so by the time the worker starts the schema is already applied. Exiting
# 1 here would strand the worker on the old image with the API migrated -- the
# exact stranding this batch exists to prevent.
DEPLOY_TEST_APP=deploy-test-worker \
DEPLOY_TEST_MIGRATION_SERVICE=deploy-test \
  run_release worker-lane-skips-migration true true false 0
printf '%s\n' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  smoke \
  task:reconcile \
  >"$test_directory/worker-lane-skips-migration/expected.log"
diff -u \
  "$test_directory/worker-lane-skips-migration/expected.log" \
  "$test_directory/worker-lane-skips-migration/aws.log"
assert_aws_log_lacks worker-lane-skips-migration "migrate.js" "The worker lane ran the migrator; it shares one image with the API."
assert_output_contains worker-lane-skips-migration "Skipping migrations for deploy-test-worker"

# The SAME flag on the lane that DOES own migrations still runs them. Without
# this pair, a `MIGRATION_SERVICE` guard that skipped unconditionally would pass
# the case above and silently migrate nothing, ever.
DEPLOY_TEST_APP=deploy-test \
DEPLOY_TEST_MIGRATION_SERVICE=deploy-test \
  run_release owning-lane-runs-migration true true false 0
printf '%s\n' \
  'task:node packages/backend/dist/db/migrate.js --target-database=homiio --phase=pre' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  smoke \
  task:reconcile \
  >"$test_directory/owning-lane-runs-migration/expected.log"
diff -u \
  "$test_directory/owning-lane-runs-migration/expected.log" \
  "$test_directory/owning-lane-runs-migration/aws.log"

# ── THE WIRING ITSELF, READ OUT OF deploy-aws.yml ───────────────────────────
#
# Every case above proves the SCRIPT behaves correctly when it is handed
# `RUN_MIGRATIONS=true`. None of them proves anything hands it that, and for
# months nothing did: the flag defaulted to `false`, no workflow set it, and this
# suite was green throughout. Production ran four migrations behind while
# `check-migration-phases.mjs` verified that every one of them DECLARED a phase —
# a passing gate about a pipeline that did nothing with the declaration.
#
# So these two cases take the values out of the workflow file and drive the
# script with them. They fail if `RUN_MIGRATIONS` stops being `true`, if
# `MIGRATION_SERVICE` stops naming the API lane, or if the post-deploy migration
# command is removed or moved — which is the whole point, because none of those
# edits breaks anything else in this repository.
#
# WHICH LANE declares the post-deploy command is not observable from here; this
# suite only sees that exactly one lane does. `deployMigrationWiring.test.ts`
# owns the lane attribution, and reads the same file.

workflow_file="$repository_root/.github/workflows/deploy-aws.yml"

# A WORKFLOW-LEVEL `env:` value, matched at exactly two spaces of indent.
#
# The indent is the assertion, not decoration: a step-level `env:` binding sits
# at ten, so a pattern that ignored leading space would happily read a value
# scoped to one step and report it as the job-wide default. Exactly one match is
# required — zero means the key was renamed, more than one means two scopes
# disagree and this helper cannot say which one the deploy reads.
workflow_env_value() {
  local key="$1" matches value
  matches="$(grep -cE "^  ${key}:" "$workflow_file" || true)"
  if [[ "$matches" != "1" ]]; then
    echo "ASSERTION FAILED: expected exactly one workflow-level \`${key}:\` in $workflow_file, found $matches." >&2
    exit 1
  fi
  value="$(grep -E "^  ${key}:" "$workflow_file" | head -1)"
  value="${value#*: }"
  value="${value%\'}"
  value="${value#\'}"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value"
}

workflow_run_migrations="$(workflow_env_value RUN_MIGRATIONS)"
workflow_migration_service="$(workflow_env_value MIGRATION_SERVICE)"
# The API lane's own service name, read from `APP` rather than from
# MIGRATION_SERVICE.
#
# THAT DISTINCTION IS THE WHOLE CASE, and it was measured: deriving the lane from
# MIGRATION_SERVICE made both cases below pass with MIGRATION_SERVICE mutated to
# `homiio-worker`, because the API-lane case then WAS the worker and happily ran
# the migrator there. A check that names its subject after the value it is
# checking cannot fail — the same shape as a table map derived from a collection
# name. Read from APP, the same mutation turns both cases red.
workflow_app="$(workflow_env_value APP)"

# THE GATE, stated before it is used, so a failure names the value rather than
# surfacing as a confusing diff twenty lines later.
if [[ "$workflow_run_migrations" != "true" ]]; then
  echo "ASSERTION FAILED: deploy-aws.yml sets RUN_MIGRATIONS to '$workflow_run_migrations', not 'true'." >&2
  echo "The deploy would push an image and roll it out without applying a single migration," >&2
  echo "and every job in this repository would still be green — which is exactly what" >&2
  echo "happened until 2026-08-10." >&2
  exit 1
fi
if [[ -z "$workflow_migration_service" ]]; then
  echo "ASSERTION FAILED: deploy-aws.yml declares no MIGRATION_SERVICE." >&2
  echo "Without it BOTH lanes run the migrator on one release, and the migrator holds" >&2
  echo "no cross-process lock." >&2
  exit 1
fi
if [[ -z "$workflow_app" ]]; then
  echo "ASSERTION FAILED: deploy-aws.yml declares no APP, so neither lane below has a name." >&2
  exit 1
fi

# Exactly one lane may declare a post-deploy task. Two would run the post
# migration twice per release; none would never run it at all, and an unapplied
# `post` migration is silent until the NEXT release's `pre` run blocks behind it.
workflow_post_command_matches="$(grep -cE "^ {10}POST_DEPLOY_TASK_COMMAND_JSON:" "$workflow_file" || true)"
if [[ "$workflow_post_command_matches" != "1" ]]; then
  echo "ASSERTION FAILED: expected exactly one lane in $workflow_file to set POST_DEPLOY_TASK_COMMAND_JSON, found $workflow_post_command_matches." >&2
  exit 1
fi
workflow_post_command="$(grep -E "^ {10}POST_DEPLOY_TASK_COMMAND_JSON:" "$workflow_file" | head -1)"
workflow_post_command="${workflow_post_command#*: }"
workflow_post_command="${workflow_post_command%\'}"
workflow_post_command="${workflow_post_command#\'}"
if ! jq -e 'type == "array" and length > 0' <<<"$workflow_post_command" >/dev/null; then
  echo "ASSERTION FAILED: the post-deploy command in $workflow_file is not a non-empty JSON array: $workflow_post_command" >&2
  exit 1
fi
workflow_post_command_line="task:$(jq -r 'join(" ")' <<<"$workflow_post_command")"

# The API lane, with the workflow's own values. It runs the `pre` migrator before
# `update-service` and declares NO post-deploy task, which is why this case sets
# `none` rather than inheriting the harness's `reconcile` fixture.
DEPLOY_TEST_APP="$workflow_app" \
DEPLOY_TEST_MIGRATION_SERVICE="$workflow_migration_service" \
DEPLOY_TEST_POST_DEPLOY_TASK_COMMAND_JSON=none \
  run_release workflow-api-lane-migrates true "$workflow_run_migrations" false 0
printf '%s\n' \
  'task:node packages/backend/dist/db/migrate.js --target-database=homiio --phase=pre' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  smoke \
  >"$test_directory/workflow-api-lane-migrates/expected.log"
diff -u \
  "$test_directory/workflow-api-lane-migrates/expected.log" \
  "$test_directory/workflow-api-lane-migrates/aws.log"
assert_aws_log_lacks workflow-api-lane-migrates "--phase=post" "The API lane ran the post migration. It rolls FIRST, so the worker would still be serving the previous image when a DROP landed."

# The worker lane, same workflow values. It declines the `pre` migrator because
# MIGRATION_SERVICE names the API, and it runs the `post` phase AFTER its own
# rollout — the first moment no old image is serving, since both services share
# one image and this one rolls last.
DEPLOY_TEST_APP="${workflow_app}-worker" \
DEPLOY_TEST_MIGRATION_SERVICE="$workflow_migration_service" \
DEPLOY_TEST_POST_DEPLOY_TASK_COMMAND_JSON="$workflow_post_command" \
  run_release workflow-worker-lane-migrates-post true "$workflow_run_migrations" false 0
printf '%s\n' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  smoke \
  "$workflow_post_command_line" \
  >"$test_directory/workflow-worker-lane-migrates-post/expected.log"
diff -u \
  "$test_directory/workflow-worker-lane-migrates-post/expected.log" \
  "$test_directory/workflow-worker-lane-migrates-post/aws.log"
assert_aws_log_lacks workflow-worker-lane-migrates-post "--phase=pre" "The worker lane ran the pre migrator. Both services share one image and the migrator holds no cross-process lock, so it must run exactly once per release."
assert_output_contains workflow-worker-lane-migrates-post "Skipping migrations for ${workflow_app}-worker"
# The ORDER is the assertion, and a whole-log diff is what sees it: a `post`
# migration recorded before `update-service` would be a DROP applied while the
# previous image was still serving.
assert_output_contains workflow-worker-lane-migrates-post "ECS rollout reached a healthy steady state"

# A migration one-shot that never STOPS is the case that reaches the EXIT trap's
# unfinished-task warning -- the only signal that a migration may still be
# mutating the database after the deploy gave up, and unrecoverable because the
# deploy role cannot call ecs:StopTask.
#
# This case exists to protect the migration loop's PROCESS SUBSTITUTION. Piping
# into the loop instead puts its body in a subshell, so run_one_shot_command's
# active_one_shot_* writes never reach the parent and the trap reads their
# initial values -- the warning silently stops being emitted. `set -e` catches
# the failing pipeline either way, so nothing else here can tell the two forms
# apart: the release stops before update-service under both.
DEPLOY_TEST_TASK_LAST_STATUS=RUNNING
run_release migration-task-never-stops false true false 0
DEPLOY_TEST_TASK_LAST_STATUS=STOPPED
printf '%s\n' \
  'task:node packages/backend/dist/db/migrate.js --target-database=homiio --phase=pre' \
  >"$test_directory/migration-task-never-stops/expected.log"
diff -u \
  "$test_directory/migration-task-never-stops/expected.log" \
  "$test_directory/migration-task-never-stops/aws.log"
if ! grep -qF \
  "Unfinished Postgres migration task arn:aws:ecs:test:task/deploy-test-one-shot may still be running" \
  "$test_directory/migration-task-never-stops/output.log"; then
  echo "The EXIT trap did not warn that a migration task may still be running." >&2
  echo "The migration loop is probably a pipe: its body runs in a subshell, so" >&2
  echo "active_one_shot_task_arn never reaches the parent and the trap sees ''." >&2
  exit 1
fi

run_release transient-zero-deployment true false false 0 false 1 transient-zero-deployment
printf '%s\n' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  smoke \
  task:reconcile \
  >"$test_directory/transient-zero-deployment/expected.log"
diff -u \
  "$test_directory/transient-zero-deployment/expected.log" \
  "$test_directory/transient-zero-deployment/aws.log"
assert_output_contains transient-zero-deployment "has not assigned desired tasks"

run_release zero-service-during-deploy false false false 0 false 1 zero-service-during-deploy
printf '%s\n' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:1:desired=1' \
  >"$test_directory/zero-service-during-deploy/expected.log"
diff -u \
  "$test_directory/zero-service-during-deploy/expected.log" \
  "$test_directory/zero-service-during-deploy/aws.log"
assert_output_contains zero-service-during-deploy "service deploy-test reached desiredCount=0 during the deployment rollout"

run_release completed-zero-deployment false false false 0 false 1 completed-zero-deployment
printf '%s\n' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:1:desired=1' \
  >"$test_directory/completed-zero-deployment/expected.log"
diff -u \
  "$test_directory/completed-zero-deployment/expected.log" \
  "$test_directory/completed-zero-deployment/aws.log"
assert_output_contains completed-zero-deployment "completed at desiredCount=0; refusing to accept a zero-task steady state"

# A smoke failure the smoke script attributes to the new image rolls the service
# back, and stops the release before the reconciliation task runs.
run_release smoke-hermetic-failure false false false 0 false 1 healthy 1
printf '%s\n' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  smoke \
  'service:arn:aws:ecs:test:task-definition/deploy-test:1:desired=1' \
  >"$test_directory/smoke-hermetic-failure/expected.log"
diff -u \
  "$test_directory/smoke-hermetic-failure/expected.log" \
  "$test_directory/smoke-hermetic-failure/aws.log"
assert_output_contains smoke-hermetic-failure "Post-deploy smoke checks failed."

# A smoke failure the smoke script attributes to something outside the new image
# (exit 75) must NOT roll back: the service stays on the new task definition, the
# release finishes its reconciliation task, and the job still fails so the
# failure is paged rather than swallowed.
run_release smoke-no-rollback-failure false false false 0 false 1 healthy 75
printf '%s\n' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=1' \
  smoke \
  task:reconcile \
  >"$test_directory/smoke-no-rollback-failure/expected.log"
diff -u \
  "$test_directory/smoke-no-rollback-failure/expected.log" \
  "$test_directory/smoke-no-rollback-failure/aws.log"
assert_aws_log_lacks smoke-no-rollback-failure 'service:arn:aws:ecs:test:task-definition/deploy-test:1:' "A smoke failure that cannot be repaired by a rollback rolled back anyway."
assert_output_contains smoke-no-rollback-failure "stays on arn:aws:ecs:test:task-definition/deploy-test:2"
assert_output_contains smoke-no-rollback-failure "Nothing was rolled back; this release needs a human."

# A service parked at desiredCount 0 -- the state the cutover leaves both Homiio
# services in -- must still land its image, because the release that would make
# the service bootable again is the one a refusal blocks.
#
# This REPLACES the ALLOW_ZERO_DESIRED_COUNT opt-in, which refused by default and
# permitted only with a dated `<service>:<YYYY-MM-DD>` variable. That mechanism
# was never reachable in production: the script read the variable and
# `deploy-aws.yml` never passed it, so the six cases that tested it exercised an
# env var no deploy could set. It is deleted rather than left inert.
#
# The exact log is the whole assertion, and what it does NOT contain matters more
# than what it does. Compare `migration-order` above, the same release at
# desired=1: there, `service:` is followed by `smoke` and `task:reconcile`. Here
# the log must STOP at `service:`, because neither is real when nothing is
# running -- a smoke check against a service with zero tasks is the plausible
# green this case exists to refuse. `diff -u` fails if either appears.
run_release zero-desired-count true true false 0 false 0
printf '%s\n' \
  'task:node packages/backend/dist/db/migrate.js --target-database=homiio --phase=pre' \
  'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=0' \
  >"$test_directory/zero-desired-count/expected.log"
diff -u \
  "$test_directory/zero-desired-count/expected.log" \
  "$test_directory/zero-desired-count/aws.log"
# `service:...deploy-test:2:...` is the REPOINT, and it is the half that is easy
# to drop: registering a revision does not point the service at it, so without
# this line a later scale-up would launch the OLD image and every subsequent
# deploy would render from the stale revision. Homiio has TWO services, each
# carrying its own revision, so each lane has to repoint its own.
assert_aws_log_contains zero-desired-count 'service:arn:aws:ecs:test:task-definition/deploy-test:2:desired=0' "A zero-capacity release did not repoint the service, so a later scale-up would launch the OLD image."
assert_output_contains zero-desired-count "NO ROLLOUT PERFORMED: ECS service deploy-test is at desiredCount=0"
assert_output_contains zero-desired-count "NO ROLLOUT PERFORMED: the task definition WAS registered and the service now points at it: arn:aws:ecs:test:task-definition/deploy-test:2"
assert_output_contains zero-desired-count "NO ROLLOUT PERFORMED: image example.invalid"
# The success line of an ordinary release. If it ever appears here, a reader of
# the workflow log six weeks from now cannot tell this run apart from one that
# actually shipped, which is the failure this whole case exists to prevent.
assert_output_lacks zero-desired-count "ECS rollout reached a healthy steady state" "A zero-capacity release claimed a healthy rollout it never performed."

# A non-numeric desiredCount still REFUSES, and is deliberately split from the
# zero case above: ECS declining to say what the count is, is not the same fact
# as a zero it reports confidently. Without this, folding the numeric check into
# the zero check would wave through a service whose count could not be read at
# all -- and it is the negative control for the case above, since deleting the
# numeric check outright would otherwise leave the suite green.
run_release non-numeric-desired-count false false false 0 false '"unknown"'
assert_output_contains non-numeric-desired-count "reported a non-numeric desiredCount"
assert_no_aws_calls non-numeric-desired-count "A service with an unreadable desiredCount reached a mutating AWS call."

if (( cases_run < MINIMUM_CASES )); then
  echo "ASSERTION FAILED: only $cases_run release cases ran, expected at least $MINIMUM_CASES." >&2
  echo "The suite exited green without executing everything it claims to check." >&2
  exit 1
fi

echo "Deployment script transaction tests passed ($cases_run release cases)."
