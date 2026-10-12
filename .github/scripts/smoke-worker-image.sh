#!/usr/bin/env bash
# Boot the built WORKER image the way ECS runs it, against a throwaway PostGIS
# (already migrated by smoke-api-image.sh) and Redis, and fail unless:
#   1. the deploy's own worker command — read from deploy-aws.yml's
#      TASK_COMMAND_JSON, `xvfb-run … bun packages/backend/dist/worker.js` —
#      names the runtime the image's CMD names,
#   2. Playwright launches Chromium on that runtime inside the image, headless
#      AND headed under the image's xvfb-run with the deploy's display args,
#   3. that command boots the worker onto BullMQ with the browser tier loaded,
#      under tini as PID 1 and with the worker itself running the bun binary,
#   4. SIGTERM (`docker stop`, as ECS does on a rollout) travels tini ->
#      xvfb-run -> the worker, reaches its shutdown handler, and the container
#      exits 0 — the worker's own code, not the wrapper's 143,
#   5. a worker that cannot reach its database exits NON-ZERO through xvfb-run.
# None of these is visible to a unit suite: they are properties of the image.
set -euo pipefail

: "${WORKER_IMAGE:?WORKER_IMAGE required}"
: "${DATABASE_URL:?DATABASE_URL required (a migrated throwaway PostGIS database)}"
: "${REDIS_URL:?REDIS_URL required (a throwaway Redis)}"
NAME="homiio-worker-smoke-$$"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() {
  echo "::error::$*"
  exit 1
}

# The command production runs, read from where production reads it, so this
# cannot drift into testing a command nobody deploys.
command_line="$(grep -E "^ {10}TASK_COMMAND_JSON:" "$ROOT/.github/workflows/deploy-aws.yml")" ||
  fail "deploy-aws.yml declares no worker TASK_COMMAND_JSON"
command_json="${command_line#*: }"
command_json="${command_json#\'}"
command_json="${command_json%\'}"
mapfile -t worker_command < <(jq -r '.[]' <<<"$command_json")
[ "${#worker_command[@]}" -ge 3 ] || fail "could not read the worker command from deploy-aws.yml"
echo "worker command: ${worker_command[*]}"

# Split it at the runtime: everything before is the display wrapper, which the
# Playwright probe below reuses verbatim.
n="${#worker_command[@]}"
[ "${worker_command[$((n - 1))]}" = packages/backend/dist/worker.js ] ||
  fail "the worker command does not end in packages/backend/dist/worker.js"
runtime="${worker_command[$((n - 2))]}"
wrapper=("${worker_command[@]:0:$((n - 2))}")
[ "${wrapper[0]:-}" = xvfb-run ] || fail "the worker command does not run under xvfb-run"
image_cmd="$(docker inspect -f '{{json .Config.Cmd}}' "$WORKER_IMAGE")"
[ "$(jq -r '.[0]' <<<"$image_cmd")" = "$runtime" ] ||
  fail "the deploy runs the worker on '$runtime' but the image's CMD is $image_cmd"
[ "$runtime" = bun ] || fail "the worker command runs '$runtime', expected bun"

# Playwright on the worker's runtime, in the image, as the unprivileged user.
# Headed is the mode production runs (LISTING_BROWSER_HEADED) and the one that
# needs the virtual display; headless is the fallback when the flag is off.
#
# The headed check reads `screen.width` instead of taking a screenshot: a headed
# capture under Xvfb fails intermittently on BOTH runtimes (measured 2026-10-12:
# 2-3 runs in 10 on Bun and on Node alike), and a flaky gate gets switched off. The
# screen width is the X display's, so 1920 proves the page rendered on the
# virtual display the deploy's `--server-args` created.
probe='
const { chromium } = require("playwright");
(async () => {
  for (const headless of [true, false]) {
    const browser = await chromium.launch({ headless });
    // `viewport: null` so the page reports the real screen, not an emulated one.
    const page = await browser.newPage({ viewport: null });
    await page.setContent("<p id=probe>rendered</p>");
    const text = await page.textContent("#probe");
    const width = await page.evaluate(() => screen.width);
    await browser.close();
    if (text !== "rendered") throw new Error(`headless=${headless}: bad render`);
    if (!headless && width !== 1920) throw new Error(`headed screen.width=${width}, expected the 1920 Xvfb display`);
    console.log(`playwright ok headless=${headless} screen.width=${width}`);
  }
  console.log(`runtime bun=${process.versions.bun ?? "none"}`);
})().catch((error) => { console.error(error); process.exit(1); });
'
probe_out="$(docker run --rm "$WORKER_IMAGE" "${wrapper[@]}" "$runtime" -e "$probe" 2>&1)" || {
  printf '%s\n' "$probe_out"
  fail "Playwright did not launch Chromium under ${wrapper[*]} $runtime in the worker image"
}
printf '%s\n' "$probe_out"
grep -q 'playwright ok headless=false' <<<"$probe_out" || fail "the headed launch did not report success"
grep -qE '^runtime bun=[0-9]' <<<"$probe_out" || fail "the Playwright probe did not run on Bun"

# The worker itself, with the browser tier and headed mode on as production has
# them. Boot discovery stays off so the smoke never scrapes the internet, and the
# proxy re-check is off because no proxy is configured.
docker run -d --name "$NAME" --network host \
  -e DATABASE_URL -e REDIS_URL \
  -e LISTING_DISCOVER_ON_BOOT=false \
  -e LISTING_BROWSER_ENABLED=true \
  -e LISTING_BROWSER_HEADED=true \
  -e LISTING_PROXY_CHECK_INTERVAL_MINUTES=0 \
  "$WORKER_IMAGE" "${worker_command[@]}" >/dev/null

started=
for _ in $(seq 1 90); do
  if docker logs "$NAME" 2>&1 | grep -q 'Listing worker started on BullMQ'; then
    started=1
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != true ]; then
    break
  fi
  sleep 1
done
if [ -z "$started" ]; then
  docker logs "$NAME" || true
  fail "the worker never reported 'Listing worker started on BullMQ'"
fi
# `browserTier: true` means Playwright loaded on this runtime at boot; without
# it the worker silently runs HTTP-only and every challenged portal fails.
docker logs "$NAME" 2>&1 | grep -q '"browserTier": true' || {
  docker logs "$NAME" || true
  fail "the worker booted without its browser tier (Playwright did not load)"
}

# tini is PID 1 and its child is the xvfb-run wrapper; the worker under that is
# the bun binary running the compiled entrypoint.
pid1="$(docker exec "$NAME" cat /proc/1/cmdline | tr '\0' ' ')"
[ "$pid1" = "/usr/bin/tini -- ${worker_command[*]} " ] ||
  fail "PID 1 is '$pid1', expected '/usr/bin/tini -- ${worker_command[*]}'"
worker_exe="$(docker exec "$NAME" sh -c '
  for p in /proc/[0-9]*; do
    tr "\0" " " <"$p/cmdline" 2>/dev/null | grep -q "packages/backend/dist/worker.js" || continue
    exe="$(readlink "$p/exe" 2>/dev/null)" || continue
    case "$exe" in */sh|*/dash|*/tini) continue ;; esac
    echo "$exe"
  done' | sort -u)"
[ "$worker_exe" = /usr/local/bin/bun ] ||
  fail "the worker process runs '$worker_exe', expected /usr/local/bin/bun"

docker stop -t 35 "$NAME" >/dev/null
exit_code="$(docker inspect -f '{{.State.ExitCode}}' "$NAME")"
logs="$(docker logs "$NAME" 2>&1)"
if [ "$exit_code" != 0 ] || ! grep -q 'Received SIGTERM, shutting down listing worker' <<<"$logs"; then
  printf '%s\n' "$logs"
  fail "SIGTERM did not reach the worker's shutdown and end in exit 0 (exit code $exit_code)"
fi

# A worker that cannot open its store must fail LOUDLY, through the wrapper:
# exit 0 here would read as a clean stop to ECS and the circuit breaker.
set +e
timeout 180 docker run --rm --network host -e REDIS_URL \
  -e DATABASE_URL=postgres://homiio:homiio@127.0.0.1:1/homiio \
  "$WORKER_IMAGE" "${worker_command[@]}" >/dev/null 2>&1
unreachable_db=$?
set -e
[ "$unreachable_db" != 0 ] && [ "$unreachable_db" != 124 ] ||
  fail "the worker did not exit non-zero on an unreachable database (exit $unreachable_db)"

echo "Worker image smoke passed: deploy command on bun, Playwright headless + headed under xvfb-run, BullMQ boot with the browser tier, bun under tini, graceful SIGTERM exit 0, failed boot exits non-zero"
