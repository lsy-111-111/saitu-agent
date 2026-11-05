#!/usr/bin/env bash
set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
umask 077
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
BACKUP_INSPECTOR="$SCRIPT_DIR/inspect-postgres-backups.py"
RETENTION_SELECTOR="$SCRIPT_DIR/select-postgres-retention.py"
[ -f "$BACKUP_INSPECTOR" ] && [ ! -L "$BACKUP_INSPECTOR" ] \
  || fail "backup inspector is missing or unsafe"
[ -f "$RETENTION_SELECTOR" ] && [ ! -L "$RETENTION_SELECTOR" ] \
  || fail "backup retention selector is missing or unsafe"
case "${1:-}" in daily|weekly|predeploy|scheduled) MODE=$1 ;; *) fail "usage: backup-postgres.sh daily|weekly|predeploy|scheduled" ;; esac

DB_NAME=resume_ai
BACKUP_TIMEZONE=Asia/Shanghai
DAILY_RETENTION=14
WEEKLY_RETENTION=8
PREDEPLOY_RETENTION=5
RPO_HOURS=24
RTO_SECONDS=7200
CONFIG_FILE=/etc/resume-ai/backup.env
BACKUP_CONFIG_STATE=""
if [ -e "$CONFIG_FILE" ] || [ -L "$CONFIG_FILE" ]; then
  BACKUP_CONFIG_STATE="$(stat -c '%d:%i:%s:%Y:%Z' "$CONFIG_FILE")" \
    || fail "cannot snapshot PostgreSQL backup configuration identity"
  CONFIG_READER="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/read-backup-config.sh"
  "$CONFIG_READER" validate "$CONFIG_FILE"
  DB_NAME="$("$CONFIG_READER" get DB_NAME "$CONFIG_FILE")"
  BACKUP_TIMEZONE="$("$CONFIG_READER" get BACKUP_TIMEZONE "$CONFIG_FILE")"
  DAILY_RETENTION="$("$CONFIG_READER" get DAILY_RETENTION "$CONFIG_FILE")"
  WEEKLY_RETENTION="$("$CONFIG_READER" get WEEKLY_RETENTION "$CONFIG_FILE")"
  PREDEPLOY_RETENTION="$("$CONFIG_READER" get PREDEPLOY_RETENTION "$CONFIG_FILE")"
  RPO_HOURS="$("$CONFIG_READER" get RPO_HOURS "$CONFIG_FILE")"
  RTO_SECONDS="$("$CONFIG_READER" get RTO_SECONDS "$CONFIG_FILE")"
  [ "$(stat -c '%d:%i:%s:%Y:%Z' "$CONFIG_FILE")" = "$BACKUP_CONFIG_STATE" ] \
    || fail "PostgreSQL backup configuration changed while it was parsed"
fi
[[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "invalid DB_NAME"
[ "$BACKUP_TIMEZONE" = Asia/Shanghai ] \
  || fail "BACKUP_TIMEZONE must match the installed Asia/Shanghai backup timer"
for retention in DAILY_RETENTION WEEKLY_RETENTION PREDEPLOY_RETENTION; do
  case "${!retention}" in *[!0-9]*) fail "$retention must be an integer" ;; esac
  [ "${!retention}" -ge 1 ] || fail "$retention must be positive"
done
[ "$DAILY_RETENTION" -ge 14 ] || fail "daily retention cannot be below 14"
[ "$WEEKLY_RETENTION" -ge 8 ] || fail "weekly retention cannot be below 8"
[ "$PREDEPLOY_RETENTION" -ge 5 ] || fail "predeploy retention cannot be below 5"

for required_command in awk chmod date find flock install mv pg_dump pg_dumpall pg_restore psql python3 runuser sha256sum stat sync; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command is unavailable"
done

BACKUP_ROOT=/var/backups/resume-ai/postgresql
for backup_path in /var/backups/resume-ai "$BACKUP_ROOT" \
  "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/predeploy"; do
  [ ! -L "$backup_path" ] || fail "backup directory path is a symlink: $backup_path"
done
install -d -o root -g root -m 0700 /var/backups/resume-ai "$BACKUP_ROOT" \
  "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/predeploy"
deploy_lock_path=/run/resume-ai-locks/deploy.lock
if [ -e "/proc/$$/fd/9" ]; then
  [ "$(readlink "/proc/$$/fd/9")" = "$deploy_lock_path" ] \
    && [ "$(stat -Lc '%d:%i' "/proc/$$/fd/9")" = "$(stat -c '%d:%i' "$deploy_lock_path")" ] \
    && flock -n 9 \
    || fail "inherited descriptor 9 is not the held Resume AI deploy lock"
else
  open_root_lock 9 deploy
fi
role_lock_path=/run/resume-ai-locks/postgres-role-hardening.lock
if [ -e "/proc/$$/fd/6" ]; then
  [ "$(readlink "/proc/$$/fd/6")" = "$role_lock_path" ] \
    && [ "$(stat -Lc '%d:%i' "/proc/$$/fd/6")" = "$(stat -c '%d:%i' "$role_lock_path")" ] \
    && flock -n 6 \
    || fail "inherited descriptor 6 is not the held PostgreSQL role-hardening lock"
else
  open_root_lock 6 postgres-role-hardening
fi
open_root_lock 8 postgres-backup

trusted_helper_mode=755
if [[ "$SCRIPT_DIR" =~ ^(/var/lib/resume-ai/bootstrap-generations/generation-([a-f0-9]{64}))/ops/bin$ ]]; then
  bootstrap_generation=${BASH_REMATCH[1]}
  bootstrap_manifest=${BASH_REMATCH[2]}
  bootstrap_copier=/usr/local/lib/resume-ai/create-bootstrap-generation.py
  [ -f "$bootstrap_copier" ] && [ ! -L "$bootstrap_copier" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$bootstrap_copier")" = root:root:555:1 ] \
    && /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
      /usr/bin/python3 -I "$bootstrap_copier" verify \
      "$bootstrap_generation" "$bootstrap_manifest" >/dev/null \
    || fail "PostgreSQL backup bootstrap generation is not independently verified"
  trusted_helper_mode=500
fi
for trusted_helper in "$SCRIPT_DIR/backup-postgres.sh" "$BACKUP_INSPECTOR" "$RETENTION_SELECTOR"; do
  [ -f "$trusted_helper" ] && [ ! -L "$trusted_helper" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$trusted_helper")" \
      = "root:root:$trusted_helper_mode:1" ] \
    || fail "PostgreSQL backup helper is not a single immutable root-owned file: $trusted_helper"
done
BACKUP_WRITER_SHA256="$(sha256sum "$SCRIPT_DIR/backup-postgres.sh" | awk '{print $1}')"
BACKUP_INSPECTOR_SHA256="$(sha256sum "$BACKUP_INSPECTOR" | awk '{print $1}')"
RETENTION_SELECTOR_SHA256="$(sha256sum "$RETENTION_SELECTOR" | awk '{print $1}')"
if [ -e "$CONFIG_FILE" ] || [ -L "$CONFIG_FILE" ]; then
  BACKUP_CONFIG_SOURCE=file
  BACKUP_CONFIG_SHA256="$(sha256sum "$CONFIG_FILE" | awk '{print $1}')"
else
  BACKUP_CONFIG_SOURCE=builtin-v1
  BACKUP_CONFIG_SHA256="$(printf '%s\n' \
    'DB_NAME=resume_ai' \
    'BACKUP_TIMEZONE=Asia/Shanghai' \
    'DAILY_RETENTION=14' \
    'WEEKLY_RETENTION=8' \
    'PREDEPLOY_RETENTION=5' \
    'RPO_HOURS=24' \
    'RTO_SECONDS=7200' | sha256sum | awk '{print $1}')"
fi

postgres_peer() {
  runuser -u postgres -- env -i PATH=/usr/bin:/bin PGHOST=/var/run/postgresql PGUSER=postgres "$@"
}

ACTIVE_STAGING_DIR=""

# `find -xdev` does not protect a deletion from a bind mount whose source is
# on the same filesystem.  Backup directories are root-only, so after this
# topology check the backup lock also prevents an in-scope writer from racing
# the deletion.  Fail closed if Linux mount topology is unavailable.
assert_no_mounts_below() {
  local candidate=$1
  python3 - "$candidate" <<'PY'
import pathlib
import sys

candidate = pathlib.Path(sys.argv[1]).resolve(strict=True)
mountinfo = pathlib.Path("/proc/self/mountinfo")
if not mountinfo.is_file():
    raise SystemExit("mount topology is unavailable")

def decode_mount_path(value: str) -> str:
    return (value.replace("\\040", " ")
                 .replace("\\011", "\t")
                 .replace("\\012", "\n")
                 .replace("\\134", "\\"))

for line in mountinfo.read_text(encoding="utf-8").splitlines():
    fields = line.split()
    if len(fields) < 5:
        raise SystemExit("malformed mount topology")
    mount = pathlib.Path(decode_mount_path(fields[4]))
    try:
        mount.relative_to(candidate)
    except ValueError:
        continue
    raise SystemExit(f"nested mount prevents safe deletion: {mount}")
PY
}

safe_delete_backup_tree() {
  local candidate=$1
  [ -d "$candidate" ] && [ ! -L "$candidate" ] || return 1
  assert_no_mounts_below "$candidate" || return 1
  find "$candidate" -xdev -depth -delete
  [ ! -e "$candidate" ] && [ ! -L "$candidate" ]
}

recover_incomplete_tier() {
  local tier=$1
  local tier_dir="$BACKUP_ROOT/$tier"
  local candidate
  while IFS= read -r -d '' candidate; do
    [[ "$candidate" =~ ^${tier_dir}/\.(incomplete|pruning)-20[0-9]{6}T[0-9]{6}Z-[1-9][0-9]*$ ]] \
      || fail "refusing to recover an unexpected PostgreSQL staging path: $candidate"
    [ -d "$candidate" ] && [ ! -L "$candidate" ] \
      && [ "$(stat -c '%U:%G:%a' "$candidate")" = root:root:700 ] \
      || fail "incomplete PostgreSQL backup has unsafe ownership or type: $candidate"
    safe_delete_backup_tree "$candidate" \
      || fail "incomplete PostgreSQL backup could not be recovered safely: $candidate"
  done < <(find "$tier_dir" -mindepth 1 -maxdepth 1 -type d \
    \( -name '.incomplete-20??????T??????Z-[1-9]*' \
       -o -name '.pruning-20??????T??????Z-[1-9]*' \) -print0)
}

for backup_tier in daily weekly predeploy; do
  recover_incomplete_tier "$backup_tier"
done

cleanup_incomplete_on_exit() {
  local exit_status=$?
  trap - EXIT
  if [[ "$ACTIVE_STAGING_DIR" =~ ^/var/backups/resume-ai/postgresql/(daily|weekly|predeploy)/\.incomplete-20[0-9]{6}T[0-9]{6}Z-[1-9][0-9]*$ ]] \
    && [ -d "$ACTIVE_STAGING_DIR" ] && [ ! -L "$ACTIVE_STAGING_DIR" ]; then
    safe_delete_backup_tree "$ACTIVE_STAGING_DIR" >/dev/null 2>&1 \
      || printf '%s\n' "WARNING: incomplete backup retained because it could not be deleted safely: $ACTIVE_STAGING_DIR" >&2
  fi
  exit "$exit_status"
}
trap cleanup_incomplete_on_exit EXIT

prune_tier() {
  local tier=$1
  local retention=$2
  local tier_dir="$BACKUP_ROOT/$tier"
  local inspected_backups
  local expired_backups
  local pruning_path
  inspected_backups="$(python3 "$BACKUP_INSPECTOR" "$tier_dir" "$tier" "$DB_NAME")" \
    || fail "published $tier backup set failed structural/timestamp validation"
  expired_backups="$(printf '%s\n' "$inspected_backups" \
    | python3 "$RETENTION_SELECTOR" "$tier" "$retention" "$(date -u +%F)")" \
    || fail "could not calculate the $tier UTC calendar retention window"
  while IFS= read -r expired; do
    [ -n "$expired" ] || continue
    case "$expired" in
      "$tier_dir"/20??????T??????Z)
        [ -d "$expired" ] && [ ! -L "$expired" ] || fail "unsafe backup retention member: $expired"
        pruning_path="$tier_dir/.pruning-${expired##*/}-$$"
        [ ! -e "$pruning_path" ] && [ ! -L "$pruning_path" ] \
          || fail "backup retention tombstone already exists: $pruning_path"
        mv -T -- "$expired" "$pruning_path"
        sync -f "$tier_dir"
        safe_delete_backup_tree "$pruning_path" \
          || fail "backup retention member contains a mount or could not be deleted safely: $expired"
        sync -f "$tier_dir"
        ;;
      *) fail "refusing to prune unexpected backup path: $expired" ;;
    esac
  done <<< "$expired_backups"
}

create_backup() {
  local tier=$1
  local retention=$2
  local backup_id
  local tier_dir="$BACKUP_ROOT/$tier"
  backup_id="$(date -u +%Y%m%dT%H%M%SZ)"
  local staging_dir="$tier_dir/.incomplete-$backup_id-$$"
  local final_dir="$tier_dir/$backup_id"
  [ ! -e "$final_dir" ] || fail "backup already exists: $final_dir"
  install -d -o root -g root -m 0700 "$staging_dir"
  ACTIVE_STAGING_DIR=$staging_dir

  postgres_peer pg_dump --format=custom --compress=9 \
    --dbname="$DB_NAME" > "$staging_dir/database.dump"
  postgres_peer pg_dumpall --globals-only > "$staging_dir/globals.sql"
  pg_restore --list "$staging_dir/database.dump" > "$staging_dir/archive.list"
  postgres_version="$(postgres_peer psql --dbname="$DB_NAME" --no-psqlrc --tuples-only --no-align --command='SHOW server_version;')"
  data_checksums="$(postgres_peer psql --dbname="$DB_NAME" --no-psqlrc --tuples-only --no-align --command='SHOW data_checksums;')"
  database_size="$(postgres_peer psql --dbname="$DB_NAME" --no-psqlrc --tuples-only --no-align --command="SELECT pg_database_size(current_database());")"
  peer_contract="$(postgres_peer psql --dbname="$DB_NAME" --no-psqlrc --tuples-only --no-align \
    --field-separator=$'\t' --command="SELECT inet_server_addr() IS NULL AND current_user='postgres',
      current_setting('data_directory'), (pg_control_system()).system_identifier::text;")"
  IFS=$'\t' read -r peer_gate peer_data_dir system_identifier <<< "$peer_contract"
  [ "$peer_gate" = t ] && [[ "$peer_data_dir" =~ ^/var/lib/postgresql/[0-9]+/main$ ]] \
    && [[ "$system_identifier" =~ ^[0-9]{10,}$ ]] \
    || fail "backup connection is not the approved local postgres peer cluster"
  [[ "$postgres_version" =~ ^[0-9]+\.[0-9]+([.][0-9]+)?([[:space:]][-A-Za-z0-9._+]+)*$ ]] \
    && [[ "$data_checksums" =~ ^(on|off)$ ]] \
    && [[ "$database_size" =~ ^[0-9]+$ ]] \
    || fail "PostgreSQL backup metadata is malformed"
  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  backup_id_epoch="$(date -u -d "${backup_id:0:4}-${backup_id:4:2}-${backup_id:6:2} ${backup_id:9:2}:${backup_id:11:2}:${backup_id:13:2}Z" +%s 2>/dev/null)" \
    || fail "generated backup ID has an invalid timestamp"
  created_epoch="$(date -d "$created_at" +%s 2>/dev/null)" \
    || fail "generated backup creation timestamp is invalid"
  now_epoch=$(date +%s)
  creation_span=$((created_epoch - backup_id_epoch))
  [ $((now_epoch - backup_id_epoch)) -ge -300 ] \
    && [ $((now_epoch - created_epoch)) -ge -300 ] \
    && [ "$creation_span" -ge 0 ] && [ "$creation_span" -le 86400 ] \
    || fail "generated backup ID and creation timestamps are inconsistent"
  cat > "$staging_dir/manifest.env" <<EOF
BACKUP_ID=$backup_id
BACKUP_SCHEMA_VERSION=2
BACKUP_TIER=$tier
DATABASE_NAME=$DB_NAME
CREATED_AT=$created_at
POSTGRES_VERSION=$postgres_version
DATA_CHECKSUMS=$data_checksums
SYSTEM_IDENTIFIER=$system_identifier
DATABASE_SIZE_BYTES=$database_size
RPO_HOURS=$RPO_HOURS
RTO_SECONDS=$RTO_SECONDS
BACKUP_WRITER_SHA256=$BACKUP_WRITER_SHA256
BACKUP_INSPECTOR_SHA256=$BACKUP_INSPECTOR_SHA256
RETENTION_SELECTOR_SHA256=$RETENTION_SELECTOR_SHA256
BACKUP_CONFIG_SOURCE=$BACKUP_CONFIG_SOURCE
BACKUP_CONFIG_SHA256=$BACKUP_CONFIG_SHA256
EOF
  (
    cd "$staging_dir"
    sha256sum database.dump globals.sql archive.list manifest.env > SHA256SUMS
    sha256sum -c SHA256SUMS >/dev/null
  )
  find "$staging_dir" -maxdepth 1 -type f -exec chmod 0600 {} +
  while IFS= read -r -d '' backup_member; do sync -f "$backup_member"; done \
    < <(find "$staging_dir" -maxdepth 1 -type f -print0)
  sync -f "$staging_dir"
  # Recheck immediately before the atomic publish so a clock anomaly cannot
  # create a lexicographically future backup that permanently captures the
  # latest-backup selector.
  publish_now_epoch=$(date +%s)
  [ $((publish_now_epoch - backup_id_epoch)) -ge -300 ] \
    && [ $((publish_now_epoch - created_epoch)) -ge -300 ] \
    || fail "refusing to publish a future-dated PostgreSQL backup"
  [ "$(sha256sum "$SCRIPT_DIR/backup-postgres.sh" | awk '{print $1}')" = "$BACKUP_WRITER_SHA256" ] \
    && [ "$(sha256sum "$BACKUP_INSPECTOR" | awk '{print $1}')" = "$BACKUP_INSPECTOR_SHA256" ] \
    && [ "$(sha256sum "$RETENTION_SELECTOR" | awk '{print $1}')" = "$RETENTION_SELECTOR_SHA256" ] \
    || fail "PostgreSQL backup helpers changed during the transaction"
  if [ "$BACKUP_CONFIG_SOURCE" = file ]; then
    [ -f "$CONFIG_FILE" ] && [ ! -L "$CONFIG_FILE" ] \
      && [ "$(stat -c '%d:%i:%s:%Y:%Z' "$CONFIG_FILE")" = "$BACKUP_CONFIG_STATE" ] \
      && [ "$(sha256sum "$CONFIG_FILE" | awk '{print $1}')" = "$BACKUP_CONFIG_SHA256" ] \
      || fail "PostgreSQL backup configuration changed during the transaction"
  else
    [ ! -e "$CONFIG_FILE" ] && [ ! -L "$CONFIG_FILE" ] \
      || fail "PostgreSQL backup configuration appeared during the transaction"
  fi
  mv -T -- "$staging_dir" "$final_dir"
  ACTIVE_STAGING_DIR=""
  sync -f "$tier_dir"
  prune_tier "$tier" "$retention"
  printf '%s\n' "Created $tier PostgreSQL backup: $final_dir"
}

case "$MODE" in
  daily) create_backup daily "$DAILY_RETENTION" ;;
  weekly) create_backup weekly "$WEEKLY_RETENTION" ;;
  predeploy) create_backup predeploy "$PREDEPLOY_RETENTION" ;;
  scheduled)
    create_backup daily "$DAILY_RETENTION"
    if [ "$(TZ="$BACKUP_TIMEZONE" date +%u)" = "7" ]; then
      create_backup weekly "$WEEKLY_RETENTION"
    fi
    ;;
esac
trap - EXIT
