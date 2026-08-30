#!/bin/sh
# Container-safe xvfb-run for the Homiio listing worker.
#
# Debian's wrapper waits indefinitely for Xvfb to signal SIGUSR1 even after the
# display socket is live in an unprivileged container. This implementation
# keeps the two options used by the ECS command and gates readiness on the Unix
# socket plus a live Xvfb process, with a bounded timeout.

set -eu

server_num=99
auto_server_num=false
server_args='-screen 0 1280x1024x24'

while [ "$#" -gt 0 ]; do
  case "$1" in
    -a|--auto-servernum)
      auto_server_num=true
      shift
      ;;
    -s|--server-args)
      server_args=${2:?--server-args requires a value}
      shift 2
      ;;
    --server-args=*)
      server_args=${1#*=}
      shift
      ;;
    --)
      shift
      break
      ;;
    -h|--help)
      echo 'usage: xvfb-run [-a] [--server-args=ARGS] command [args...]'
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

if [ "$#" -eq 0 ]; then
  echo 'xvfb-run: command is required' >&2
  exit 2
fi

if [ ! -d /tmp/.X11-unix ]; then
  mkdir /tmp/.X11-unix
  chmod 1777 /tmp/.X11-unix
fi

if [ "$auto_server_num" = true ]; then
  while [ -e "/tmp/.X${server_num}-lock" ] || [ -S "/tmp/.X11-unix/X${server_num}" ]; do
    server_num=$((server_num + 1))
  done
fi

run_dir=$(mktemp -d /tmp/homiio-xvfb.XXXXXX)
auth_file="$run_dir/Xauthority"
error_file="$run_dir/Xvfb.log"
touch "$auth_file"
xauth -f "$auth_file" add ":$server_num" . "$(mcookie)"

# server_args is a trusted deployment setting and intentionally undergoes word
# splitting so Xvfb receives flags such as `-screen 0 1920x1080x24` separately.
# shellcheck disable=SC2086
Xvfb ":$server_num" $server_args -nolisten tcp -auth "$auth_file" >"$error_file" 2>&1 &
xvfb_pid=$!
command_pid=''

cleanup() {
  trap - EXIT INT TERM
  if [ -n "$command_pid" ]; then
    kill "$command_pid" 2>/dev/null || true
  fi
  kill "$xvfb_pid" 2>/dev/null || true
  wait "$xvfb_pid" 2>/dev/null || true
  rm -rf "$run_dir"
}
trap cleanup EXIT INT TERM

attempt=0
while [ "$attempt" -lt 200 ]; do
  if ! kill -0 "$xvfb_pid" 2>/dev/null; then
    echo 'xvfb-run: Xvfb exited before becoming ready' >&2
    cat "$error_file" >&2
    exit 1
  fi
  if [ -S "/tmp/.X11-unix/X${server_num}" ]; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.05
done

if [ ! -S "/tmp/.X11-unix/X${server_num}" ]; then
  echo "xvfb-run: display :$server_num was not ready after 10 seconds" >&2
  cat "$error_file" >&2
  exit 1
fi

DISPLAY=":$server_num" XAUTHORITY="$auth_file" "$@" &
command_pid=$!
set +e
wait "$command_pid"
status=$?
set -e
command_pid=''
exit "$status"
