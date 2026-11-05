#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 255
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "Node runtime recovery gate accepts no arguments"

PENDING_FILE=/opt/nodejs/node-runtime.pending
RUNTIME_DIR=/run/resume-ai-locks
LIVE_MARKER="$RUNTIME_DIR/node-runtime.live"
START_TICKS_READER=/usr/local/lib/resume-ai/read-proc-start-ticks.py
[ -f "$START_TICKS_READER" ] && [ ! -L "$START_TICKS_READER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$START_TICKS_READER")" = root:root:755:1 ] \
  || fail "installed process start-time reader is missing or unsafe"

pending_exists=0
if [ -e "$PENDING_FILE" ] || [ -L "$PENDING_FILE" ]; then
  [ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$PENDING_FILE")" = root:root:600:1 ] \
    || fail "Node runtime recovery journal is unsafe"
  pending_exists=1
fi

if [ ! -e "$LIVE_MARKER" ] && [ ! -L "$LIVE_MARKER" ]; then
  [ "$pending_exists" -eq 1 ] && exit 0
  exit 1
fi
[ -d "$RUNTIME_DIR" ] && [ ! -L "$RUNTIME_DIR" ] \
  && [ "$(readlink -e -- "$RUNTIME_DIR")" = "$RUNTIME_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$RUNTIME_DIR")" = root:root:700 ] \
  || fail "Node runtime recovery directory is unsafe"
[ -f "$LIVE_MARKER" ] && [ ! -L "$LIVE_MARKER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$LIVE_MARKER")" = root:root:600:1 ] \
  || fail "Node runtime live marker is unsafe"

SCHEMA_VERSION=
PID=
START_TIME_TICKS=
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in
    SCHEMA_VERSION)
      [ -z "$SCHEMA_VERSION" ] || fail "duplicate Node live-marker key"
      SCHEMA_VERSION=$value
      ;;
    PID)
      [ -z "$PID" ] || fail "duplicate Node live-marker key"
      PID=$value
      ;;
    START_TIME_TICKS)
      [ -z "$START_TIME_TICKS" ] || fail "duplicate Node live-marker key"
      START_TIME_TICKS=$value
      ;;
    *) fail "unknown Node live-marker key" ;;
  esac
done < "$LIVE_MARKER"
[ "$SCHEMA_VERSION" = 1 ] \
  && [[ "$PID" =~ ^[1-9][0-9]*$ ]] \
  && [[ "$START_TIME_TICKS" =~ ^[1-9][0-9]*$ ]] \
  || fail "Node runtime live marker is malformed"

if [ -r "/proc/$PID/stat" ] && [ "$(stat -c '%u' "/proc/$PID")" = 0 ]; then
  actual_start_time="$("$START_TICKS_READER" "$PID")" \
    || fail "cannot read the live Node installer process identity"
  if [ "$actual_start_time" = "$START_TIME_TICKS" ] \
    && tr '\0' '\n' < "/proc/$PID/cmdline" \
      | grep -Eq '(^|/)install-node-runtime\.sh$'; then
    # Exit 1 skips recovery without failing a normal installer-owned PM2 restart.
    exit 1
  fi
fi

unlink "$LIVE_MARKER" || fail "stale Node installer marker could not be removed"
sync -f "$RUNTIME_DIR" || fail "stale Node installer marker removal is not durable"
[ "$pending_exists" -eq 1 ] && exit 0
exit 1
