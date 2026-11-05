#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "$#" -ge 1 ] && [ "$#" -le 3 ] || fail "usage: read-backup-config.sh validate|get [KEY] [FILE]"
MODE=$1
case "$MODE" in validate|get) ;; *) fail "mode must be validate or get" ;; esac
if [ "$MODE" = get ]; then
  [ "$#" -ge 2 ] || fail "get requires a key"
  REQUESTED_KEY=$2
  CONFIG_FILE=${3:-/etc/resume-ai/backup.env}
else
  [ "$#" -le 2 ] || fail "validate accepts at most a file"
  REQUESTED_KEY=""
  CONFIG_FILE=${2:-/etc/resume-ai/backup.env}
fi

[ -e "$CONFIG_FILE" ] || fail "$CONFIG_FILE does not exist"
[ ! -L "$CONFIG_FILE" ] && [ -f "$CONFIG_FILE" ] || fail "$CONFIG_FILE must be an ordinary file"
[ "$(stat -c '%U:%G:%a:%h' "$CONFIG_FILE")" = "root:root:600:1" ] \
  || fail "$CONFIG_FILE must be a single root:root mode-0600 file"

declare -A values=()
declare -A seen=()
while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  case "$raw_line" in ''|'#'*) continue ;; *$'\r'*) fail "CRLF is not accepted in $CONFIG_FILE" ;; esac
  case "$raw_line" in *=*) ;; *) fail "expected KEY=VALUE in $CONFIG_FILE" ;; esac
  key=${raw_line%%=*}
  value=${raw_line#*=}
  case "$key" in DB_NAME|BACKUP_TIMEZONE|DAILY_RETENTION|WEEKLY_RETENTION|PREDEPLOY_RETENTION|RPO_HOURS|RTO_SECONDS) ;; *) fail "unapproved backup key: $key" ;; esac
  [ -z "${seen[$key]:-}" ] || fail "duplicate backup key: $key"
  [ -n "$value" ] || fail "empty backup value: $key"
  seen[$key]=1
  values[$key]=$value
done < "$CONFIG_FILE"

for required_key in DB_NAME BACKUP_TIMEZONE DAILY_RETENTION WEEKLY_RETENTION PREDEPLOY_RETENTION RPO_HOURS RTO_SECONDS; do
  [ -n "${seen[$required_key]:-}" ] || fail "missing backup key: $required_key"
done
[[ "${values[DB_NAME]}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "invalid DB_NAME"
[ "${values[BACKUP_TIMEZONE]}" = Asia/Shanghai ] \
  || fail "BACKUP_TIMEZONE must be Asia/Shanghai to match the installed backup timer"
for integer_key in DAILY_RETENTION WEEKLY_RETENTION PREDEPLOY_RETENTION RPO_HOURS RTO_SECONDS; do
  [[ "${values[$integer_key]}" =~ ^[0-9]+$ ]] || fail "$integer_key must be an integer"
  [ "${values[$integer_key]}" -gt 0 ] || fail "$integer_key must be positive"
done
[ "${values[DAILY_RETENTION]}" -ge 14 ] || fail "DAILY_RETENTION cannot be below 14"
[ "${values[WEEKLY_RETENTION]}" -ge 8 ] || fail "WEEKLY_RETENTION cannot be below 8"
[ "${values[PREDEPLOY_RETENTION]}" -ge 5 ] || fail "PREDEPLOY_RETENTION cannot be below 5"
[ "${values[RPO_HOURS]}" -le 24 ] || fail "RPO_HOURS cannot exceed 24"
[ "${values[RTO_SECONDS]}" -le 7200 ] || fail "RTO_SECONDS cannot exceed 7200"

if [ "$MODE" = get ]; then
  case "$REQUESTED_KEY" in DB_NAME|BACKUP_TIMEZONE|DAILY_RETENTION|WEEKLY_RETENTION|PREDEPLOY_RETENTION|RPO_HOURS|RTO_SECONDS) ;; *) fail "unapproved requested key" ;; esac
  printf '%s' "${values[$REQUESTED_KEY]}"
fi
