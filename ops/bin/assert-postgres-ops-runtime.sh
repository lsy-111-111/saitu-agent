#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
LC_ALL=C
export LC_ALL

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -ge 1 ] && [ "$#" -le 2 ] \
  || fail "usage: assert-postgres-ops-runtime.sh ABSOLUTE_OPS_DIR [units|full]"
OPS_DIR=$1
MODE=${2:-full}
case "$MODE" in units|full) ;; *) fail "verification mode must be units or full" ;; esac
case "$OPS_DIR" in /*/ops) ;; *) fail "PostgreSQL ops source must be an absolute ops directory" ;; esac
[ -d "$OPS_DIR" ] && [ ! -L "$OPS_DIR" ] \
  && [ "$(cd -- "$OPS_DIR" && pwd -P)" = "$OPS_DIR" ] \
  || fail "PostgreSQL ops source is not a physical directory"
for command_name in cmp flock python3 readlink runuser sha256sum stat systemctl systemd-analyze; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is unavailable"
done
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[ -f "$SCRIPT_DIR/open-root-lock.sh" ] && [ ! -L "$SCRIPT_DIR/open-root-lock.sh" ] \
  || fail "PostgreSQL runtime gate cannot locate the root lock helper"
. "$SCRIPT_DIR/open-root-lock.sh"
deploy_lock_path=/run/resume-ai-locks/deploy.lock
if [ -e "/proc/$$/fd/9" ]; then
  [ "$(readlink "/proc/$$/fd/9")" = "$deploy_lock_path" ] \
    && [ "$(stat -Lc '%d:%i' "/proc/$$/fd/9")" = "$(stat -c '%d:%i' "$deploy_lock_path")" ] \
    && flock -n 9 \
    || fail "inherited descriptor 9 is not the held Resume AI deploy lock"
else
  open_root_lock 9 deploy
fi

property() {
  local unit=$1
  local name=$2
  systemctl show "$unit" --property="$name" --value
}

expect_property() {
  local unit=$1
  local name=$2
  local expected=$3
  local actual
  actual="$(property "$unit" "$name")"
  [ "$actual" = "$expected" ] \
    || fail "$unit effective $name differs (expected '$expected', got '$actual')"
}

expect_word_set() {
  local unit=$1
  local name=$2
  shift 2
  local actual normalized expected
  actual="$(property "$unit" "$name" | tr '[:upper:]' '[:lower:]')"
  normalized="$(tr ' ' '\n' <<< "$actual" | sed '/^$/d' | sort -u | tr '\n' ' ' | sed 's/ $//')"
  expected="$(printf '%s\n' "$@" | tr '[:upper:]' '[:lower:]' | sed '/^$/d' | sort -u | tr '\n' ' ' | sed 's/ $//')"
  [ "$normalized" = "$expected" ] \
    || fail "$unit effective $name set differs (expected '$expected', got '$normalized')"
}

assert_root_immutable_source() {
  local source_path=$1
  local source_mode
  [ -f "$source_path" ] && [ ! -L "$source_path" ] \
    && [ "$(stat -c '%U:%h' "$source_path")" = root:1 ] \
    || fail "reviewed PostgreSQL source is missing or unsafe: $source_path"
  source_mode="$(stat -c '%a' "$source_path")"
  [[ "$source_mode" =~ ^[0-7]{3,4}$ ]] \
    && [ $((8#$source_mode & 8#022)) -eq 0 ] \
    || fail "reviewed PostgreSQL source is writable by an untrusted identity: $source_path"
}

unit_files=(
  resume-ai-postgres-backup.service
  resume-ai-postgres-backup.timer
  resume-ai-postgres-restore-verify.service
  resume-ai-postgres-restore-verify.timer
  resume-ai-postgres-ops-alert@.service
)
for unit in "${unit_files[@]}"; do
  source_unit="$OPS_DIR/systemd/$unit"
  installed_unit="/etc/systemd/system/$unit"
  assert_root_immutable_source "$source_unit"
  [ -f "$installed_unit" ] && [ ! -L "$installed_unit" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$installed_unit")" = root:root:644:1 ] \
    || fail "installed PostgreSQL unit is missing or unsafe: $unit"
  cmp -s "$source_unit" "$installed_unit" \
    || fail "installed PostgreSQL unit differs from reviewed source: $unit"
  expect_property "$unit" LoadState loaded
  expect_property "$unit" FragmentPath "$installed_unit"
  expect_property "$unit" DropInPaths ""
done

helper_contracts=(
  backup-postgres.sh:755
  verify-postgres-restore.sh:755
  inspect-postgres-backups.py:755
  select-postgres-retention.py:755
  assert-postgres-restore-evidence.py:755
  assert-postgres-ops-runtime.sh:755
  enable-postgres-checksums.sh:755
  read-backup-config.sh:755
  read-postgres-runtime-identity.sh:755
  open-root-lock.sh:755
)
for helper_contract in "${helper_contracts[@]}"; do
  helper=${helper_contract%:*}
  helper_mode=${helper_contract#*:}
  source_helper="$OPS_DIR/bin/$helper"
  installed_helper="/usr/local/lib/resume-ai/$helper"
  assert_root_immutable_source "$source_helper"
  [ -f "$installed_helper" ] && [ ! -L "$installed_helper" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$installed_helper")" = "root:root:$helper_mode:1" ] \
    || fail "installed PostgreSQL helper is missing or unsafe: $helper"
  cmp -s "$source_helper" "$installed_helper" \
    || fail "installed PostgreSQL helper differs from reviewed source: $helper"
done

for policy_contract in \
  postgresql/restore-required-tables.txt:/etc/resume-ai/restore-required-tables.txt \
  postgresql/runtime-table-privileges.conf:/etc/resume-ai/runtime-table-privileges.conf \
  postgresql/runtime-function-privileges.conf:/etc/resume-ai/runtime-function-privileges.conf; do
  source_policy="$OPS_DIR/${policy_contract%%:*}"
  installed_policy=${policy_contract#*:}
  assert_root_immutable_source "$source_policy"
  [ -f "$installed_policy" ] && [ ! -L "$installed_policy" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$installed_policy")" = root:root:644:1 ] \
    && cmp -s "$source_policy" "$installed_policy" \
    || fail "installed PostgreSQL policy differs from reviewed source: $installed_policy"
done

service_units=(resume-ai-postgres-backup.service resume-ai-postgres-restore-verify.service)
for unit in "${service_units[@]}"; do
  expect_property "$unit" Type oneshot
  expect_property "$unit" User root
  expect_property "$unit" Group root
  expect_property "$unit" UMask 0077
  expect_property "$unit" RuntimeDirectory resume-ai-locks
  expect_property "$unit" RuntimeDirectoryMode 0700
  expect_property "$unit" RuntimeDirectoryPreserve yes
  expect_property "$unit" NoNewPrivileges yes
  expect_property "$unit" PrivateTmp yes
  expect_property "$unit" PrivateDevices yes
  expect_property "$unit" PrivateIPC yes
  expect_property "$unit" ProtectSystem strict
  expect_property "$unit" ProtectHome yes
  expect_property "$unit" ProtectKernelTunables yes
  expect_property "$unit" ProtectKernelModules yes
  expect_property "$unit" ProtectKernelLogs yes
  expect_property "$unit" ProtectControlGroups yes
  expect_property "$unit" ProtectClock yes
  expect_property "$unit" ProtectHostname yes
  expect_property "$unit" ProtectProc invisible
  expect_property "$unit" ProcSubset pid
  expect_property "$unit" RestrictSUIDSGID yes
  expect_property "$unit" RestrictNamespaces yes
  expect_property "$unit" RestrictRealtime yes
  expect_property "$unit" LockPersonality yes
  expect_property "$unit" SystemCallArchitectures native
  expect_word_set "$unit" RestrictAddressFamilies AF_UNIX
  expect_word_set "$unit" ReadWritePaths /run/resume-ai-locks /var/backups/resume-ai
  expect_word_set "$unit" CapabilityBoundingSet \
    CAP_CHOWN CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH CAP_SETGID CAP_SETUID
  expect_property "$unit" AmbientCapabilities ""
  expect_property "$unit" Nice 10
done
expect_property resume-ai-postgres-backup.service TimeoutStartUSec 2h
expect_property resume-ai-postgres-restore-verify.service TimeoutStartUSec '2h 15min'

backup_exec="$(property resume-ai-postgres-backup.service ExecStart)"
restore_exec="$(property resume-ai-postgres-restore-verify.service ExecStart)"
case "$backup_exec" in
  *'path=/usr/local/lib/resume-ai/backup-postgres.sh ; argv[]=/usr/local/lib/resume-ai/backup-postgres.sh scheduled ; ignore_errors=no'*) ;;
  *) fail "PostgreSQL backup effective ExecStart differs from the reviewed command" ;;
esac
case "$restore_exec" in
  *'path=/usr/local/lib/resume-ai/verify-postgres-restore.sh ; argv[]=/usr/local/lib/resume-ai/verify-postgres-restore.sh ; ignore_errors=no'*) ;;
  *) fail "PostgreSQL restore effective ExecStart differs from the reviewed command" ;;
esac
[ "$(grep -o 'path=' <<< "$backup_exec" | wc -l)" -eq 1 ] \
  && [ "$(grep -o 'path=' <<< "$restore_exec" | wc -l)" -eq 1 ] \
  || fail "PostgreSQL service has an alternate effective command"

verify_timer() {
  local timer=$1
  local service=$2
  local calendar=$3
  local randomized_delay=$4
  local effective_calendar
  systemctl is-enabled --quiet "$timer" || fail "$timer is not enabled"
  systemctl is-active --quiet "$timer" || fail "$timer is not active"
  expect_property "$timer" Persistent yes
  expect_property "$timer" AccuracyUSec 1min
  expect_property "$timer" RandomizedDelayUSec "$randomized_delay"
  expect_property "$timer" TimersMonotonic ""
  expect_word_set "$timer" Triggers "$service"
  expect_word_set "$service" TriggeredBy "$timer"
  effective_calendar="$(property "$timer" TimersCalendar)"
  [ "$(grep -o 'OnCalendar=' <<< "$effective_calendar" | wc -l)" -eq 1 ] \
    && grep -Fq "OnCalendar=$calendar" <<< "$effective_calendar" \
    || fail "$timer has an alternate or unexpected effective calendar"
  [ "$(property "$timer" NextElapseUSecRealtime)" != n/a ] \
    && [ -n "$(property "$timer" NextElapseUSecRealtime)" ] \
    || fail "$timer has no next realtime elapse"
  systemd-analyze calendar --iterations=3 "$calendar" >/dev/null \
    || fail "$timer calendar cannot be evaluated by the host systemd"
}

verify_timer \
  resume-ai-postgres-backup.timer \
  resume-ai-postgres-backup.service \
  '*-*-* 02:20:00 Asia/Shanghai' \
  0
verify_timer \
  resume-ai-postgres-restore-verify.timer \
  resume-ai-postgres-restore-verify.service \
  '*-*-01 03:30:00 Asia/Shanghai' \
  20min

if [ "$MODE" = units ]; then
  printf '%s\n' "PostgreSQL systemd/timer effective contract passed."
  exit 0
fi

ACTIVE_ROOT="$(readlink -e /opt/resume-ai/current)" \
  || fail "active release pointer cannot be resolved"
[ "$OPS_DIR" = "$ACTIVE_ROOT/ops" ] \
  || fail "PostgreSQL runtime gate was not invoked from the active physical release"
[ ! -e /var/backups/resume-ai/postgresql/restore-verifications/.restore-pending.env ] \
  && [ ! -L /var/backups/resume-ai/postgresql/restore-verifications/.restore-pending.env ] \
  || fail "an incomplete PostgreSQL restore transaction is pending"
for unit in "${service_units[@]}"; do
  expect_property "$unit" Result success
  expect_property "$unit" ExecMainStatus 0
done
CONFIG_FILE=/etc/resume-ai/backup.env
/usr/local/lib/resume-ai/read-backup-config.sh validate "$CONFIG_FILE"
DB_NAME="$(/usr/local/lib/resume-ai/read-backup-config.sh get DB_NAME "$CONFIG_FILE")"
BACKUP_TIMEZONE="$(/usr/local/lib/resume-ai/read-backup-config.sh get BACKUP_TIMEZONE "$CONFIG_FILE")"
[ "$BACKUP_TIMEZONE" = Asia/Shanghai ] \
  || fail "backup timezone differs from the installed Asia/Shanghai timer contract"
peer_contract="$(runuser -u postgres -- env -i PATH=/usr/bin:/bin \
  PGHOST=/var/run/postgresql PGUSER=postgres psql --dbname="$DB_NAME" --no-psqlrc \
  --tuples-only --no-align --field-separator=$'\t' --command="SELECT inet_server_addr() IS NULL,
    current_setting('data_directory'), (pg_control_system()).system_identifier::text;")"
IFS=$'\t' read -r peer_is_local peer_data_dir peer_system_id <<< "$peer_contract"
[ "$peer_is_local" = t ] && [ "$peer_data_dir" = /var/lib/postgresql/14/main ] \
  && [[ "$peer_system_id" =~ ^[0-9]{10,}$ ]] \
  || fail "PostgreSQL runtime gate is not bound to the approved local PG14 cluster"
python3 /usr/local/lib/resume-ai/assert-postgres-restore-evidence.py \
  --latest-root /var/backups/resume-ai/postgresql/restore-verifications \
  --daily-root /var/backups/resume-ai/postgresql/daily \
  --active-root "$ACTIVE_ROOT" \
  --config "$CONFIG_FILE" \
  --database "$DB_NAME" \
  --system-identifier "$peer_system_id" >/dev/null

printf '%s\n' "PostgreSQL backup/restore systemd and current evidence contract passed."
