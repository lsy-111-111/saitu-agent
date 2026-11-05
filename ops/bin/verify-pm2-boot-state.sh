#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "PM2 boot verification must run as root"
[ "$#" -eq 0 ] || fail "PM2 boot verification accepts no arguments"
for command_name in basename chown chmod cmp cp date find id install mktemp mv pgrep stat sync; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is unavailable"
done

APP_UID="$(id -u resume-ai)" || fail "resume-ai account is missing"
if pgrep -u "$APP_UID" >/dev/null 2>&1; then
  fail "resume-ai already has a process before the PM2 boot trust gate"
fi

STATE_DIR=/opt/resume-ai/state
STATE_FILE="$STATE_DIR/active.env"
PM2_HOME=/var/lib/resume-ai/.pm2
DUMP_FILE="$PM2_HOME/dump.pm2"
DUMP_BACKUP_FILE="$PM2_HOME/dump.pm2.bak"
MODULE_CONFIG_FILE="$PM2_HOME/module_conf.json"
MODULE_DIRECTORY="$PM2_HOME/modules"
BACKUP_ROOT=/var/backups/resume-ai
QUARANTINE_ROOT="$BACKUP_ROOT/pm2-pending-quarantine"

[ -d "$STATE_DIR" ] && [ ! -L "$STATE_DIR" ] \
  && [ "$(stat -c '%U:%G:%a' "$STATE_DIR")" = root:resume-ai:750 ] \
  || fail "managed state directory is missing, linked, or has unsafe permissions"
[ -d "$PM2_HOME" ] && [ ! -L "$PM2_HOME" ] \
  && [ "$(stat -c '%U:%G:%a' "$PM2_HOME")" = resume-ai:resume-ai:750 ] \
  || fail "PM2 home is missing, linked, or has unsafe permissions"
[ -d "$BACKUP_ROOT" ] && [ ! -L "$BACKUP_ROOT" ] \
  && [ "$(stat -c '%U:%G:%a' "$BACKUP_ROOT")" = root:root:700 ] \
  || fail "root backup directory is missing, linked, or has unsafe permissions"

secure_pm2_module_state() {
  local module_temp
  if [ -e "$MODULE_CONFIG_FILE" ] || [ -L "$MODULE_CONFIG_FILE" ]; then
    [ -f "$MODULE_CONFIG_FILE" ] && [ ! -L "$MODULE_CONFIG_FILE" ] \
      && [ "$(stat -c '%U:%G:%h:%s' "$MODULE_CONFIG_FILE")" = resume-ai:resume-ai:1:2 ] \
      && printf '{}' | cmp -s - "$MODULE_CONFIG_FILE" \
      || fail "PM2 module configuration is non-empty, linked, or unsafe"
  fi
  module_temp="$(mktemp "$PM2_HOME/.module-conf.empty.XXXXXX")"
  printf '{}' > "$module_temp"
  chown resume-ai:resume-ai "$module_temp"
  chmod 0600 "$module_temp"
  sync -f "$module_temp"
  mv -T -f -- "$module_temp" "$MODULE_CONFIG_FILE"

  if [ -e "$MODULE_DIRECTORY" ] || [ -L "$MODULE_DIRECTORY" ]; then
    [ -d "$MODULE_DIRECTORY" ] && [ ! -L "$MODULE_DIRECTORY" ] \
      && [ "$(stat -c '%U:%G' "$MODULE_DIRECTORY")" = resume-ai:resume-ai ] \
      && [ -z "$(find "$MODULE_DIRECTORY" -mindepth 1 -print -quit)" ] \
      || fail "PM2 module persistence directory is non-empty, linked, or unsafe"
    chown resume-ai:resume-ai "$MODULE_DIRECTORY"
    chmod 0750 "$MODULE_DIRECTORY"
  else
    install -d -o resume-ai -g resume-ai -m 0750 "$MODULE_DIRECTORY"
  fi
  sync -f "$MODULE_DIRECTORY"
  sync -f "$PM2_HOME"
  [ "$(stat -c '%U:%G:%a:%h:%s' "$MODULE_CONFIG_FILE")" = resume-ai:resume-ai:600:1:2 ] \
    && printf '{}' | cmp -s - "$MODULE_CONFIG_FILE" \
    && [ "$(stat -c '%U:%G:%a' "$MODULE_DIRECTORY")" = resume-ai:resume-ai:750 ] \
    && [ -z "$(find "$MODULE_DIRECTORY" -mindepth 1 -print -quit)" ] \
    || fail "PM2 module persistence could not be normalized to an empty state"
}

reset_pm2_dump_for_recovery() {
  local reason=$1 quarantine_dir quarantine_file dump_before dump_after empty_temp dump_candidate dump_name

  if [ -e "$QUARANTINE_ROOT" ] || [ -L "$QUARANTINE_ROOT" ]; then
    [ -d "$QUARANTINE_ROOT" ] && [ ! -L "$QUARANTINE_ROOT" ] \
      && [ "$(stat -c '%U:%G:%a' "$QUARANTINE_ROOT")" = root:root:700 ] \
      || fail "PM2 quarantine root is linked or has unsafe permissions"
  else
    install -d -o root -g root -m 0700 "$QUARANTINE_ROOT"
    sync -f "$BACKUP_ROOT"
  fi

  quarantine_dir="$(mktemp -d "$QUARANTINE_ROOT/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")"
  chown root:root "$quarantine_dir"
  chmod 0700 "$quarantine_dir"
  printf '%s\n' "$reason" > "$quarantine_dir/reason.txt"
  chown root:root "$quarantine_dir/reason.txt"
  chmod 0600 "$quarantine_dir/reason.txt"
  sync -f "$quarantine_dir/reason.txt"

  for dump_candidate in "$DUMP_FILE" "$DUMP_BACKUP_FILE"; do
    if [ ! -e "$dump_candidate" ] && [ ! -L "$dump_candidate" ]; then continue; fi
    [ -f "$dump_candidate" ] && [ ! -L "$dump_candidate" ] \
      && [ "$(stat -c '%U:%G:%h' "$dump_candidate")" = resume-ai:resume-ai:1 ] \
      && [ -z "$(find "$dump_candidate" -perm /027 -print -quit)" ] \
      && [ "$(stat -c '%s' "$dump_candidate")" -le 4194304 ] \
      || fail "untrusted PM2 dump cannot be safely quarantined"
    dump_before="$(stat -c '%d:%i:%s:%Y:%Z' "$dump_candidate")"
    dump_name="$(basename "$dump_candidate")"
    quarantine_file="$quarantine_dir/$dump_name"
    cp --no-dereference --reflink=never -- "$dump_candidate" "$quarantine_file"
    chown root:root "$quarantine_file"
    chmod 0600 "$quarantine_file"
    sync -f "$quarantine_file"
    dump_after="$(stat -c '%d:%i:%s:%Y:%Z' "$dump_candidate")"
    [ "$dump_after" = "$dump_before" ] && cmp -s -- "$dump_candidate" "$quarantine_file" \
      || fail "PM2 dump changed while it was being quarantined"
  done
  sync -f "$quarantine_dir"

  for dump_candidate in "$DUMP_FILE" "$DUMP_BACKUP_FILE"; do
    empty_temp="$(mktemp "$PM2_HOME/.dump.empty.XXXXXX")"
    printf '[]\n' > "$empty_temp"
    chown resume-ai:resume-ai "$empty_temp"
    chmod 0600 "$empty_temp"
    sync -f "$empty_temp"
    mv -T -f -- "$empty_temp" "$dump_candidate"
  done
  sync -f "$PM2_HOME"
  for dump_candidate in "$DUMP_FILE" "$DUMP_BACKUP_FILE"; do
    [ "$(stat -c '%U:%G:%a:%h:%s' "$dump_candidate")" = resume-ai:resume-ai:600:1:3 ] \
      && printf '[]\n' | cmp -s - "$dump_candidate" \
      || fail "failed to install the exact empty PM2 recovery dump pair"
  done
}

install_verified_dump_backup() {
  local source_before source_after backup_temp
  source_before="$(stat -c '%d:%i:%s:%Y:%Z' "$DUMP_FILE")"
  backup_temp="$(mktemp "$PM2_HOME/.dump-backup.XXXXXX")"
  cp --no-dereference --reflink=never -- "$DUMP_FILE" "$backup_temp"
  chown resume-ai:resume-ai "$backup_temp"
  chmod 0600 "$backup_temp"
  sync -f "$backup_temp"
  source_after="$(stat -c '%d:%i:%s:%Y:%Z' "$DUMP_FILE")"
  [ "$source_after" = "$source_before" ] && cmp -s "$DUMP_FILE" "$backup_temp" \
    || fail "verified PM2 dump changed while its fallback was frozen"
  if [ -e "$DUMP_BACKUP_FILE" ] || [ -L "$DUMP_BACKUP_FILE" ]; then
    [ -f "$DUMP_BACKUP_FILE" ] && [ ! -L "$DUMP_BACKUP_FILE" ] \
      && [ "$(stat -c '%U:%G:%h' "$DUMP_BACKUP_FILE")" = resume-ai:resume-ai:1 ] \
      || fail "PM2 fallback dump is linked or unsafe"
  fi
  mv -T -f -- "$backup_temp" "$DUMP_BACKUP_FILE"
  sync -f "$PM2_HOME"
  [ "$(stat -c '%U:%G:%a:%h' "$DUMP_BACKUP_FILE")" = resume-ai:resume-ai:600:1 ] \
    && [ "$(stat -c '%s' "$DUMP_BACKUP_FILE")" -le 4194304 ] \
    && cmp -s "$DUMP_FILE" "$DUMP_BACKUP_FILE" \
    || fail "PM2 fallback dump does not exactly match the verified primary dump"
}

pending_count=0
pending_path=
for pending_file in "$STATE_DIR/deploy.pending" "$STATE_DIR/legacy-adoption.pending"; do
  if [ -e "$pending_file" ] || [ -L "$pending_file" ]; then
    [ -f "$pending_file" ] && [ ! -L "$pending_file" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$pending_file")" = root:resume-ai:640:1 ] \
      || fail "pending recovery journal is unsafe: $pending_file"
    pending_count=$((pending_count + 1))
    pending_path=$pending_file
  fi
done
[ "$pending_count" -le 1 ] || fail "multiple deployment recovery journals are present"
if [ "$pending_count" -eq 1 ]; then
  secure_pm2_module_state
  reset_pm2_dump_for_recovery "pending recovery journal: $pending_path"
  printf '%s\n' "A root-owned recovery journal will validate and rebuild PM2 from an empty trust state."
  exit 0
fi

if [ ! -e "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ]; then
  [ ! -e /opt/resume-ai/current ] && [ ! -L /opt/resume-ai/current ] \
    || fail "pre-adoption state cannot have a current release pointer"
  secure_pm2_module_state
  reset_pm2_dump_for_recovery "safe pre-adoption boot without managed active state"
  printf '%s\n' "Pre-adoption PM2 starts from an exact empty dump."
  exit 0
fi

secure_pm2_module_state
declare -A protected_contracts=()
for protected_file in "$STATE_FILE" /etc/resume-ai/app.env /etc/resume-ai/quota.env; do
  [ -f "$protected_file" ] && [ ! -L "$protected_file" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$protected_file")" = root:resume-ai:640:1 ] \
    || fail "PM2 boot input is missing, linked, or has unsafe permissions: $protected_file"
  protected_contracts[$protected_file]="$(stat -c '%d:%i:%s:%Y:%Z' "$protected_file")"
done
[ -f "$DUMP_FILE" ] && [ ! -L "$DUMP_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$DUMP_FILE")" = resume-ai:resume-ai:600:1 ] \
  && [ "$(stat -c '%s' "$DUMP_FILE")" -le 4194304 ] \
  || fail "PM2 dump is missing, linked, or writable beyond its service account"
protected_contracts[$DUMP_FILE]="$(stat -c '%d:%i:%s:%Y:%Z' "$DUMP_FILE")"

declare -A state=()
while IFS='=' read -r key value || [ -n "$key" ]; do
  case "$key" in ACTIVE_PORT|ACTIVE_RELEASE|PREVIOUS_PORT|PREVIOUS_RELEASE|SWITCHED_AT) ;; '') continue ;; *) fail "unknown active state key: $key" ;; esac
  [ -z "${state[$key]:-}" ] || fail "duplicate active state key: $key"
  state[$key]=$value
done < "$STATE_FILE"
ACTIVE_PORT=${state[ACTIVE_PORT]:-}
ACTIVE_RELEASE=${state[ACTIVE_RELEASE]:-}
PREVIOUS_PORT=${state[PREVIOUS_PORT]:-}
PREVIOUS_RELEASE=${state[PREVIOUS_RELEASE]:-}
case "$ACTIVE_PORT:$ACTIVE_RELEASE" in 3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "invalid active PM2 boot state" ;; esac
case "$PREVIOUS_PORT:$PREVIOUS_RELEASE" in none:none|3000:20??????T??????Z|3001:20??????T??????Z) ;; *) fail "invalid previous PM2 boot state" ;; esac

/opt/nodejs/current/bin/node /usr/local/lib/resume-ai/verify-pm2-topology.mjs \
  --dump-only "$DUMP_FILE" /opt/resume-ai/releases \
  "$ACTIVE_PORT" "$ACTIVE_RELEASE" "$PREVIOUS_PORT" "$PREVIOUS_RELEASE" \
  /etc/resume-ai/app.env /etc/resume-ai/quota.env
for protected_file in "${!protected_contracts[@]}"; do
  [ "$(stat -c '%d:%i:%s:%Y:%Z' "$protected_file")" = "${protected_contracts[$protected_file]}" ] \
    || fail "PM2 boot input changed during trust verification: $protected_file"
done
install_verified_dump_backup
printf '%s\n' "Persisted PM2 topology is exact before resurrect."
