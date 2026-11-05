#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 255
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 0 ] || fail "Nginx migration recovery gate accepts no arguments"

PENDING_FILE=/opt/resume-ai/state/nginx-migration.pending
RUNTIME_DIR=/run/resume-ai-locks
LIVE_MARKER="$RUNTIME_DIR/nginx-migration.live"
START_TICKS_READER=/usr/local/lib/resume-ai/read-proc-start-ticks.py
[ -f "$START_TICKS_READER" ] && [ ! -L "$START_TICKS_READER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$START_TICKS_READER")" = root:root:755:1 ] \
  || fail "installed process start-time reader is missing or unsafe"

pending_exists=0
if [ -e "$PENDING_FILE" ] || [ -L "$PENDING_FILE" ]; then
  [ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$PENDING_FILE")" = root:root:600:1 ] \
    || fail "Nginx migration journal is unsafe"
  pending_exists=1
fi

if [ ! -e "$LIVE_MARKER" ] && [ ! -L "$LIVE_MARKER" ]; then
  [ "$pending_exists" -eq 1 ] && exit 0
  exit 1
fi
[ -d "$RUNTIME_DIR" ] && [ ! -L "$RUNTIME_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$RUNTIME_DIR")" = root:root:700 ] \
  || fail "Nginx migration runtime directory is unsafe"
[ -f "$LIVE_MARKER" ] && [ ! -L "$LIVE_MARKER" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$LIVE_MARKER")" = root:root:600:1 ] \
  || fail "Nginx migration live marker is unsafe"

SCHEMA_VERSION=
PID=
START_TIME_TICKS=
declare -A seen=()
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in SCHEMA_VERSION|PID|START_TIME_TICKS) ;; *) fail "unknown Nginx migration live-marker key" ;; esac
  [ -z "${seen[$key]:-}" ] || fail "duplicate Nginx migration live-marker key"
  seen[$key]=1
  printf -v "$key" '%s' "$value"
done < "$LIVE_MARKER"
[ "$SCHEMA_VERSION" = 1 ] \
  && [[ "$PID" =~ ^[1-9][0-9]*$ ]] \
  && [[ "$START_TIME_TICKS" =~ ^[1-9][0-9]*$ ]] \
  || fail "Nginx migration live marker is malformed"

if [ -r "/proc/$PID/stat" ] && [ "$(stat -c '%u' "/proc/$PID")" = 0 ]; then
  actual_start_time="$("$START_TICKS_READER" "$PID")" \
    || fail "cannot read the live Nginx migration process identity"
  if [ "$actual_start_time" = "$START_TIME_TICKS" ] \
    && tr '\0' '\n' < "/proc/$PID/cmdline" \
      | grep -Eq '(^|/)migrate-nginx-1\.30\.4\.sh$'; then
    # ExecCondition exit 1 skips boot recovery without failing nginx.service.
    exit 1
  fi
fi

rm -f -- "$LIVE_MARKER"
sync -f "$RUNTIME_DIR"
[ "$pending_exists" -eq 1 ] && exit 0
exit 1
