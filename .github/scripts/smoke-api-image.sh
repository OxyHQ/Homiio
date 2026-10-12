#!/usr/bin/env bash
# Boot the built images the way ECS runs them, against a throwaway PostGIS, and
# fail unless:
#   1. the deploy's own migrator commands run on the image their lane uses: the
#      `pre` command from deploy-ecs-image.sh on the API image, the `post`
#      command from deploy-aws.yml on the worker image,
#   2. the API image's default CMD serves /health with 200 and a healthy store,
#   3. the API process is Bun (the image's runtime) under tini as PID 1,
#   4. SIGTERM (`docker stop`, as ECS does on a rollout) reaches the server's
#      shutdown handler and ends in exit 0,
#   5. a boot that cannot reach its database exits NON-ZERO, so ECS and the
#      circuit breaker read it as the failure it is.
# None of these is visible to a unit suite: they are properties of the images.
set -euo pipefail

: "${API_IMAGE:?API_IMAGE required}"
: "${WORKER_IMAGE:?WORKER_IMAGE required}"
: "${DATABASE_URL:?DATABASE_URL required (a throwaway PostGIS database named homiio)}"
PORT="${PORT:-4400}"
NAME="homiio-api-smoke-$$"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() {
  echo "::error::$*"
  exit 1
}

# The commands production runs, read from where production reads them, so this
# cannot drift into testing a command nobody deploys.
pre_json="$(sed -n "/^MIGRATION_TASK_COMMANDS_JSON='\[/,/^\]'/p" "$ROOT/.github/scripts/deploy-ecs-image.sh" |
  sed -e "s/^MIGRATION_TASK_COMMANDS_JSON='//" -e "s/^\]'$/]/")"
mapfile -t pre_command < <(jq -r '.[] | select(.label == "Postgres migration") | .command[]' <<<"$pre_json")
post_line="$(grep -E "^ {10}POST_DEPLOY_TASK_COMMAND_JSON:" "$ROOT/.github/workflows/deploy-aws.yml")"
post_json="${post_line#*: }"
post_json="${post_json#\'}"
post_json="${post_json%\'}"
mapfile -t post_command < <(jq -r '.[]' <<<"$post_json")
[ "${#pre_command[@]}" -gt 0 ] || fail "could not read the pre migrator command from deploy-ecs-image.sh"
[ "${#post_command[@]}" -gt 0 ] || fail "could not read the post migrator command from deploy-aws.yml"
echo "pre (API image):     ${pre_command[*]}"
echo "post (worker image): ${post_command[*]}"

# A fresh database cannot start with `pre`: the journal interleaves phases, and
# the migrator refuses a `pre` queued behind an unapplied `post` (production has
# applied both long ago). `all` builds the schema first; the deploy's own
# commands then have to run, and exit 0, against it.
docker run --rm --network host -e DATABASE_URL "$API_IMAGE" \
  "${pre_command[0]}" packages/backend/dist/db/migrate.js --target-database=homiio --phase=all
docker run --rm --network host -e DATABASE_URL "$API_IMAGE" "${pre_command[@]}"
docker run --rm --network host -e DATABASE_URL "$WORKER_IMAGE" "${post_command[@]}"

docker run -d --name "$NAME" --network host -e DATABASE_URL -e PORT="$PORT" "$API_IMAGE" >/dev/null

health=
for _ in $(seq 1 60); do
  if health="$(curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null)"; then
    break
  fi
  health=
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != true ]; then
    break
  fi
  sleep 1
done
if [ -z "$health" ]; then
  docker logs "$NAME" || true
  fail "the API image never answered /health"
fi
if [ "$(jq -r '.database.status' <<<"$health")" != healthy ]; then
  docker logs "$NAME" || true
  fail "/health answered without a healthy database: $health"
fi

# tini is PID 1 (the image's ENTRYPOINT) and execs nothing else; the server is
# its direct child and must be the bun binary running the compiled entrypoint.
pid1="$(docker exec "$NAME" cat /proc/1/cmdline | tr '\0' ' ')"
[ "$pid1" = "/usr/bin/tini -- bun packages/backend/dist/server.js " ] ||
  fail "PID 1 is '$pid1', expected '/usr/bin/tini -- bun packages/backend/dist/server.js'"
server_exe="$(docker exec "$NAME" sh -c '
  for p in /proc/[0-9]*; do
    [ "$(cat "$p/stat" 2>/dev/null | cut -d" " -f4)" = 1 ] || continue
    readlink "$p/exe"
  done')"
case "$server_exe" in
  */bun) ;;
  *) fail "the server process under tini runs '$server_exe', expected the bun binary" ;;
esac

docker stop -t 35 "$NAME" >/dev/null
exit_code="$(docker inspect -f '{{.State.ExitCode}}' "$NAME")"
logs="$(docker logs "$NAME" 2>&1)"
if [ "$exit_code" != 0 ] || ! grep -q 'Stopping backend' <<<"$logs"; then
  printf '%s\n' "$logs"
  fail "SIGTERM did not end in the graceful shutdown and exit 0 (exit code $exit_code)"
fi

# A boot that cannot open its store must fail LOUDLY. Exit 0 here would read as
# a clean stop to every orchestrator.
set +e
docker run --rm --network host -e PORT="$PORT" "$API_IMAGE" >/dev/null 2>&1
no_db=$?
timeout 180 docker run --rm --network host -e PORT="$PORT" \
  -e DATABASE_URL=postgres://homiio:homiio@127.0.0.1:1/homiio "$API_IMAGE" >/dev/null 2>&1
unreachable_db=$?
set -e
[ "$no_db" != 0 ] || fail "the API image exited 0 with no DATABASE_URL"
[ "$unreachable_db" != 0 ] && [ "$unreachable_db" != 124 ] ||
  fail "the API image did not exit non-zero on an unreachable database (exit $unreachable_db)"

echo "Image smoke passed: migrator commands on their lanes' images, /health 200, Bun under tini, graceful SIGTERM, failed boot exits non-zero"
