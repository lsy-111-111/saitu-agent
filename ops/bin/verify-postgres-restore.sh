#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
BACKUP_INSPECTOR="$SCRIPT_DIR/inspect-postgres-backups.py"
EVIDENCE_VERIFIER="$SCRIPT_DIR/assert-postgres-restore-evidence.py"
[ -f "$BACKUP_INSPECTOR" ] && [ ! -L "$BACKUP_INSPECTOR" ] \
  || fail "backup inspector is missing or unsafe"
[ -f "$EVIDENCE_VERIFIER" ] && [ ! -L "$EVIDENCE_VERIFIER" ] \
  || fail "restore evidence verifier is missing or unsafe"
umask 077
DB_NAME=resume_ai
RPO_HOURS=24
RTO_SECONDS=7200
CONFIG_FILE=/etc/resume-ai/backup.env
if [ -e "$CONFIG_FILE" ] || [ -L "$CONFIG_FILE" ]; then
  CONFIG_READER="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/read-backup-config.sh"
  "$CONFIG_READER" validate "$CONFIG_FILE"
  DB_NAME="$("$CONFIG_READER" get DB_NAME "$CONFIG_FILE")"
  RPO_HOURS="$("$CONFIG_READER" get RPO_HOURS "$CONFIG_FILE")"
  RTO_SECONDS="$("$CONFIG_READER" get RTO_SECONDS "$CONFIG_FILE")"
fi
[ -f "$CONFIG_FILE" ] && [ ! -L "$CONFIG_FILE" ] \
  && [ "$(stat -c '%U:%G:%a:%h' "$CONFIG_FILE")" = root:root:600:1 ] \
  || fail "monthly restore verification requires the installed root-only backup contract"
[[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "invalid DB_NAME"
case "$RPO_HOURS" in *[!0-9]*) fail "RPO_HOURS must be an integer" ;; esac
[ "$RPO_HOURS" -gt 0 ] && [ "$RPO_HOURS" -le 24 ] \
  || fail "RPO_HOURS is outside the approved range"
case "$RTO_SECONDS" in *[!0-9]*) fail "RTO_SECONDS must be an integer" ;; esac
[ "$RTO_SECONDS" -gt 0 ] && [ "$RTO_SECONDS" -le 7200 ] \
  || fail "RTO_SECONDS is outside the approved range"

for required_command in awk chmod chown cmp createdb date df dropdb find flock install mktemp mv pg_restore psql python3 readlink rm runuser sha256sum sort stat sync wc; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command is unavailable"
done

BACKUP_ROOT=/var/backups/resume-ai/postgresql
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
open_root_lock 7 postgres-restore-verify
postgres_peer() {
  runuser -u postgres -- env -i PATH=/usr/bin:/bin PGHOST=/var/run/postgresql PGUSER=postgres "$@"
}
VERIFY_ROOT="$BACKUP_ROOT/restore-verifications"
[ ! -L /var/backups/resume-ai ] && [ ! -L "$BACKUP_ROOT" ] && [ ! -L "$VERIFY_ROOT" ] \
  || fail "PostgreSQL restore evidence path contains a symlink"
install -d -o root -g root -m 0700 /var/backups/resume-ai "$BACKUP_ROOT" "$VERIFY_ROOT"
for trusted_helper in "$SCRIPT_DIR/verify-postgres-restore.sh" "$BACKUP_INSPECTOR" "$EVIDENCE_VERIFIER"; do
  [ -f "$trusted_helper" ] && [ ! -L "$trusted_helper" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$trusted_helper")" = root:root:755:1 ] \
    || fail "PostgreSQL restore helper is not a single immutable root-owned file: $trusted_helper"
done

RESTORE_PENDING="$VERIFY_ROOT/.restore-pending.env"
recover_incomplete_restore() {
  local orphan
  while IFS= read -r -d '' orphan; do
    case "$orphan" in "$VERIFY_ROOT"/.restore-journal.*|"$VERIFY_ROOT"/.verification.*) ;;
      *) fail "unexpected restore transaction temporary path" ;;
    esac
    [ -f "$orphan" ] && [ ! -L "$orphan" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$orphan")" = root:root:600:1 ] \
      || fail "restore transaction temporary file is unsafe"
    rm -f -- "$orphan"
  done < <(find "$VERIFY_ROOT" -mindepth 1 -maxdepth 1 -type f \
    \( -name '.restore-journal.*' -o -name '.verification.*' \) -print0)
  sync -f "$VERIFY_ROOT"
  [ -e "$RESTORE_PENDING" ] || [ -L "$RESTORE_PENDING" ] || return 0
  [ -f "$RESTORE_PENDING" ] && [ ! -L "$RESTORE_PENDING" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$RESTORE_PENDING")" = root:root:600:1 ] \
    && [ "$(stat -c '%s' "$RESTORE_PENDING")" -le 4096 ] \
    || fail "incomplete restore journal is unsafe"
  declare -A pending=()
  declare -A seen_pending=()
  local key value
  while IFS='=' read -r key value || [ -n "$key" ]; do
    case "$key" in SCHEMA|VERIFY_ID|TEMP_DB|BACKUP_ID|ACTIVE_RELEASE|CONTRACT_SHA256|PHASE) ;;
      *) fail "incomplete restore journal has an unknown key" ;;
    esac
    [ -z "${seen_pending[$key]:-}" ] && [ -n "$value" ] \
      || fail "incomplete restore journal has a duplicate or empty value"
    seen_pending[$key]=1
    pending[$key]=$value
  done < "$RESTORE_PENDING"
  [ "${#pending[@]}" -eq 7 ] && [ "${pending[SCHEMA]:-}" = 1 ] \
    && [[ "${pending[VERIFY_ID]:-}" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] \
    && [[ "${pending[TEMP_DB]:-}" =~ ^resume_ai_restore_20[0-9]{6}t[0-9]{6}z_[1-9][0-9]*$ ]] \
    && [[ "${pending[BACKUP_ID]:-}" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] \
    && [[ "${pending[ACTIVE_RELEASE]:-}" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] \
    && [[ "${pending[CONTRACT_SHA256]:-}" =~ ^[a-f0-9]{64}$ ]] \
    && [[ "${pending[PHASE]:-}" =~ ^(prepared|database_created|database_dropped|evidence_published|failed)$ ]] \
    || fail "incomplete restore journal is malformed"
  postgres_peer dropdb --if-exists --force "${pending[TEMP_DB]}" >/dev/null
  rm -f -- "$RESTORE_PENDING"
  sync -f "$VERIFY_ROOT"
}
recover_incomplete_restore
backup_candidates=()
inspected_backups="$(python3 "$BACKUP_INSPECTOR" \
  "$BACKUP_ROOT/daily" daily "$DB_NAME" --require-checksums)" \
  || fail "published daily backup set failed structural/timestamp validation"
while IFS=$'\t' read -r backup_epoch backup_path; do
  [ -z "${backup_epoch:-}" ] && continue
  [[ "$backup_epoch" =~ ^[0-9]+$ ]] && [ -n "$backup_path" ] \
    || fail "backup inspector returned a malformed row"
  backup_candidates+=("$backup_path")
done <<< "$inspected_backups"
[ "${#backup_candidates[@]}" -gt 0 ] || fail "no daily backup exists"
LATEST_BACKUP=${backup_candidates[${#backup_candidates[@]}-1]}
[ -n "$LATEST_BACKUP" ] || fail "no daily backup exists"
case "$LATEST_BACKUP" in "$BACKUP_ROOT"/daily/20??????T??????Z) ;; *) fail "unsafe backup path" ;; esac
for backup_file in database.dump globals.sql archive.list manifest.env SHA256SUMS; do
  backup_path="$LATEST_BACKUP/$backup_file"
  [ -f "$backup_path" ] && [ ! -L "$backup_path" ] \
    || fail "backup member is missing or unsafe: $backup_file"
  [ "$(stat -c '%U:%G:%a:%h' "$backup_path")" = "root:root:600:1" ] \
    || fail "backup member has unsafe ownership or permissions: $backup_file"
done

checksum_member_lines="$(awk '{ if ($1 !~ /^[a-f0-9]{64}$/ || $2 !~ /^\*?(database\.dump|globals\.sql|archive\.list|manifest\.env)$/) exit 2; sub(/^\*/, "", $2); print $2 }' "$LATEST_BACKUP/SHA256SUMS")" \
  || fail "backup checksum manifest is malformed"
mapfile -t checksum_members <<< "$checksum_member_lines"
[ "${#checksum_members[@]}" -eq 4 ] \
  && [ "$(printf '%s\n' "${checksum_members[@]}" | sort -u | wc -l)" -eq 4 ] \
  || fail "backup checksum manifest must cover each required member exactly once"
(
  cd "$LATEST_BACKUP"
  sha256sum --strict -c SHA256SUMS >/dev/null
)
BACKUP_DUMP_SHA256="$(sha256sum "$LATEST_BACKUP/database.dump" | awk '{print $1}')"
BACKUP_GLOBALS_SHA256="$(sha256sum "$LATEST_BACKUP/globals.sql" | awk '{print $1}')"
BACKUP_ARCHIVE_LIST_SHA256="$(sha256sum "$LATEST_BACKUP/archive.list" | awk '{print $1}')"
BACKUP_MANIFEST_SHA256="$(sha256sum "$LATEST_BACKUP/manifest.env" | awk '{print $1}')"
BACKUP_CHECKSUMS_SHA256="$(sha256sum "$LATEST_BACKUP/SHA256SUMS" | awk '{print $1}')"

declare -A backup_manifest=()
declare -A backup_manifest_seen=()
while IFS='=' read -r manifest_key manifest_value || [ -n "$manifest_key" ]; do
  case "$manifest_key" in BACKUP_ID|BACKUP_SCHEMA_VERSION|BACKUP_TIER|DATABASE_NAME|CREATED_AT|POSTGRES_VERSION|DATA_CHECKSUMS|SYSTEM_IDENTIFIER|DATABASE_SIZE_BYTES|RPO_HOURS|RTO_SECONDS|BACKUP_WRITER_SHA256|BACKUP_INSPECTOR_SHA256|RETENTION_SELECTOR_SHA256|BACKUP_CONFIG_SOURCE|BACKUP_CONFIG_SHA256) ;; *) fail "unknown backup manifest key" ;; esac
  [ -z "${backup_manifest_seen[$manifest_key]:-}" ] || fail "duplicate backup manifest key"
  [ -n "$manifest_value" ] || fail "empty backup manifest value"
  backup_manifest_seen[$manifest_key]=1
  backup_manifest[$manifest_key]=$manifest_value
done < "$LATEST_BACKUP/manifest.env"
[ "${#backup_manifest[@]}" -eq 16 ] \
  && [ "${backup_manifest[BACKUP_SCHEMA_VERSION]:-}" = 2 ] \
  || fail "restore source predates the current backup contract"
[ "${backup_manifest[BACKUP_ID]:-}" = "${LATEST_BACKUP##*/}" ] || fail "backup ID/path mismatch"
[ "${backup_manifest[BACKUP_TIER]:-}" = daily ] || fail "restore source is not a daily backup"
[ "${backup_manifest[DATABASE_NAME]:-}" = "$DB_NAME" ] || fail "backup database/config mismatch"
[ "${backup_manifest[DATA_CHECKSUMS]:-}" = on ] || fail "backup was not taken from a checksummed cluster"
[[ "${backup_manifest[SYSTEM_IDENTIFIER]:-}" =~ ^[0-9]{10,}$ ]] || fail "backup system identifier is invalid"
[[ "${backup_manifest[DATABASE_SIZE_BYTES]:-}" =~ ^[0-9]+$ ]] || fail "backup database size is invalid"
[ "${backup_manifest[RPO_HOURS]:-}" = "$RPO_HOURS" ] \
  && [ "${backup_manifest[RTO_SECONDS]:-}" = "$RTO_SECONDS" ] \
  || fail "backup recovery objectives differ from the current configuration"
for backup_contract_digest in BACKUP_WRITER_SHA256 BACKUP_INSPECTOR_SHA256 RETENTION_SELECTOR_SHA256 BACKUP_CONFIG_SHA256; do
  [[ "${backup_manifest[$backup_contract_digest]:-}" =~ ^[a-f0-9]{64}$ ]] \
    || fail "backup manifest contract digest is invalid: $backup_contract_digest"
done
[ "${backup_manifest[BACKUP_CONFIG_SOURCE]:-}" = file ] \
  || fail "monthly restore evidence requires an explicit root-owned backup configuration"
backup_created_epoch="$(date -d "${backup_manifest[CREATED_AT]:-}" +%s 2>/dev/null)" \
  || fail "backup creation timestamp is invalid"
backup_id=${backup_manifest[BACKUP_ID]}
backup_id_epoch="$(date -u -d "${backup_id:0:4}-${backup_id:4:2}-${backup_id:6:2} ${backup_id:9:2}:${backup_id:11:2}:${backup_id:13:2}Z" +%s 2>/dev/null)" \
  || fail "backup path timestamp is invalid"
backup_clock_delta=$(( $(date +%s) - backup_created_epoch ))
[ "$backup_clock_delta" -ge -300 ] || fail "backup creation timestamp is implausibly in the future"
[ "$backup_clock_delta" -le $((RPO_HOURS * 3600 + 300)) ] \
  || fail "latest checksummed daily backup exceeds the configured RPO"
backup_id_clock_delta=$(( $(date +%s) - backup_id_epoch ))
[ "$backup_id_clock_delta" -ge -300 ] || fail "backup path timestamp is implausibly in the future"
backup_creation_span=$(( backup_created_epoch - backup_id_epoch ))
[ "$backup_creation_span" -ge 0 ] && [ "$backup_creation_span" -le 86400 ] \
  || fail "backup path and internal creation timestamps are inconsistent"
fresh_archive_list="$(mktemp /tmp/resume-ai-pg-archive-list.XXXXXX)"
if ! pg_restore --list "$LATEST_BACKUP/database.dump" > "$fresh_archive_list"; then
  rm -f -- "$fresh_archive_list"
  fail "database dump cannot be listed"
fi
if ! cmp -s "$fresh_archive_list" "$LATEST_BACKUP/archive.list"; then
  rm -f -- "$fresh_archive_list"
  fail "archive listing differs from the protected manifest"
fi
rm -f -- "$fresh_archive_list"

ACTIVE_ROOT="$(readlink -e /opt/resume-ai/current)" \
  || fail "active release pointer cannot be resolved"
case "$ACTIVE_ROOT" in /opt/resume-ai/releases/20??????T??????Z) ;; *) fail "active release pointer is unsafe" ;; esac
ACTIVE_RELEASE=${ACTIVE_ROOT##*/}
[ -d "$ACTIVE_ROOT" ] && [ ! -L "$ACTIVE_ROOT" ] \
  && [ "$(stat -c '%U' "$ACTIVE_ROOT")" = root ] \
  || fail "active release root is not root-owned and physical"

IDENTITY_READER=/usr/local/lib/resume-ai/read-postgres-runtime-identity.sh
TABLE_POLICY=/etc/resume-ai/runtime-table-privileges.conf
FUNCTION_POLICY=/etc/resume-ai/runtime-function-privileges.conf
REQUIRED_TABLE_FILE=/etc/resume-ai/restore-required-tables.txt
RETENTION_SELECTOR="$SCRIPT_DIR/select-postgres-retention.py"
RESTORE_VERIFIER="$SCRIPT_DIR/verify-postgres-restore.sh"
MIGRATION_POLICY="$ACTIVE_ROOT/ops/config/migrations.manifest"
VERIFICATION_POLICY=/usr/local/share/resume-ai/database-verification.manifest
READONLY_DATABASE_SQL=/usr/local/share/resume-ai/verify-production-database-readonly.sql

assert_current_contract_pair() {
  local source_path=$1
  local installed_path=$2
  local installed_mode=$3
  local source_mode
  [ -f "$source_path" ] && [ ! -L "$source_path" ] \
    && [ "$(stat -c '%U:%h' "$source_path")" = root:1 ] \
    || fail "active PostgreSQL contract is missing or unsafe: $source_path"
  source_mode="$(stat -c '%a' "$source_path")"
  [[ "$source_mode" =~ ^[0-7]{3,4}$ ]] \
    && [ $((8#$source_mode & 8#022)) -eq 0 ] \
    || fail "active PostgreSQL contract is writable by an untrusted identity: $source_path"
  [ -f "$installed_path" ] && [ ! -L "$installed_path" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$installed_path")" = "root:root:$installed_mode:1" ] \
    || fail "installed PostgreSQL contract is missing or unsafe: $installed_path"
  cmp -s "$source_path" "$installed_path" \
    || fail "installed PostgreSQL contract differs from the active release: $installed_path"
}

assert_current_contract_pair "$ACTIVE_ROOT/ops/bin/backup-postgres.sh" "$SCRIPT_DIR/backup-postgres.sh" 755
assert_current_contract_pair "$ACTIVE_ROOT/ops/bin/inspect-postgres-backups.py" "$BACKUP_INSPECTOR" 755
assert_current_contract_pair "$ACTIVE_ROOT/ops/bin/select-postgres-retention.py" "$RETENTION_SELECTOR" 755
assert_current_contract_pair "$ACTIVE_ROOT/ops/bin/verify-postgres-restore.sh" "$RESTORE_VERIFIER" 755
assert_current_contract_pair "$ACTIVE_ROOT/ops/bin/assert-postgres-restore-evidence.py" "$EVIDENCE_VERIFIER" 755
assert_current_contract_pair "$ACTIVE_ROOT/ops/bin/read-postgres-runtime-identity.sh" "$IDENTITY_READER" 755
assert_current_contract_pair "$ACTIVE_ROOT/ops/postgresql/runtime-table-privileges.conf" "$TABLE_POLICY" 644
assert_current_contract_pair "$ACTIVE_ROOT/ops/postgresql/runtime-function-privileges.conf" "$FUNCTION_POLICY" 644
assert_current_contract_pair "$ACTIVE_ROOT/ops/postgresql/restore-required-tables.txt" "$REQUIRED_TABLE_FILE" 644
[ -f "$MIGRATION_POLICY" ] && [ ! -L "$MIGRATION_POLICY" ] \
  && [ "$(stat -c '%U:%h' "$MIGRATION_POLICY")" = root:1 ] \
  || fail "active PostgreSQL migration manifest is missing or unsafe"
assert_current_contract_pair "$ACTIVE_ROOT/ops/config/database-verification.manifest" \
  "$VERIFICATION_POLICY" 444
assert_current_contract_pair "$ACTIVE_ROOT/ops/postgresql/verify-production-database-readonly.sql" \
  "$READONLY_DATABASE_SQL" 444

BACKUP_WRITER_SHA256="$(sha256sum "$SCRIPT_DIR/backup-postgres.sh" | awk '{print $1}')"
BACKUP_INSPECTOR_CURRENT_SHA256="$(sha256sum "$BACKUP_INSPECTOR" | awk '{print $1}')"
RETENTION_SELECTOR_CURRENT_SHA256="$(sha256sum "$RETENTION_SELECTOR" | awk '{print $1}')"
RESTORE_VERIFIER_SHA256="$(sha256sum "$RESTORE_VERIFIER" | awk '{print $1}')"
EVIDENCE_VERIFIER_SHA256="$(sha256sum "$EVIDENCE_VERIFIER" | awk '{print $1}')"
MIGRATION_MANIFEST_SHA256="$(sha256sum "$MIGRATION_POLICY" | awk '{print $1}')"
DATABASE_VERIFICATION_MANIFEST_SHA256="$(sha256sum "$VERIFICATION_POLICY" | awk '{print $1}')"
RUNTIME_TABLE_POLICY_SHA256="$(sha256sum "$TABLE_POLICY" | awk '{print $1}')"
RUNTIME_FUNCTION_POLICY_SHA256="$(sha256sum "$FUNCTION_POLICY" | awk '{print $1}')"
REQUIRED_TABLES_POLICY_SHA256="$(sha256sum "$REQUIRED_TABLE_FILE" | awk '{print $1}')"
RUNTIME_IDENTITY_HELPER_SHA256="$(sha256sum "$IDENTITY_READER" | awk '{print $1}')"
BACKUP_CONFIG_SHA256="$(sha256sum "$CONFIG_FILE" | awk '{print $1}')"
[ "${backup_manifest[BACKUP_WRITER_SHA256]}" = "$BACKUP_WRITER_SHA256" ] \
  && [ "${backup_manifest[BACKUP_INSPECTOR_SHA256]}" = "$BACKUP_INSPECTOR_CURRENT_SHA256" ] \
  && [ "${backup_manifest[RETENTION_SELECTOR_SHA256]}" = "$RETENTION_SELECTOR_CURRENT_SHA256" ] \
  && [ "${backup_manifest[BACKUP_CONFIG_SHA256]}" = "$BACKUP_CONFIG_SHA256" ] \
  || fail "restore source was not produced under the current backup contract"

CURRENT_CONTRACT_SHA256="$({
  printf '%s\n' \
    "databaseName=$DB_NAME" \
    "postgresSystemIdentifier=${backup_manifest[SYSTEM_IDENTIFIER]}" \
    "activeRelease=$ACTIVE_RELEASE" \
    "backup=${LATEST_BACKUP##*/}" \
    "backupCreatedAt=${backup_manifest[CREATED_AT]}" \
    "backupArchiveListSha256=$BACKUP_ARCHIVE_LIST_SHA256" \
    "backupChecksumsSha256=$BACKUP_CHECKSUMS_SHA256" \
    "backupConfigSha256=$BACKUP_CONFIG_SHA256" \
    "backupDatabaseDumpSha256=$BACKUP_DUMP_SHA256" \
    "backupGlobalsSha256=$BACKUP_GLOBALS_SHA256" \
    "backupInspectorSha256=$BACKUP_INSPECTOR_CURRENT_SHA256" \
    "backupManifestSha256=$BACKUP_MANIFEST_SHA256" \
    "backupWriterSha256=$BACKUP_WRITER_SHA256" \
    "databaseVerificationManifestSha256=$DATABASE_VERIFICATION_MANIFEST_SHA256" \
    "evidenceVerifierSha256=$EVIDENCE_VERIFIER_SHA256" \
    "migrationManifestSha256=$MIGRATION_MANIFEST_SHA256" \
    "requiredTablesPolicySha256=$REQUIRED_TABLES_POLICY_SHA256" \
    "restoreVerifierSha256=$RESTORE_VERIFIER_SHA256" \
    "retentionSelectorSha256=$RETENTION_SELECTOR_CURRENT_SHA256" \
    "runtimeFunctionPolicySha256=$RUNTIME_FUNCTION_POLICY_SHA256" \
    "runtimeIdentityHelperSha256=$RUNTIME_IDENTITY_HELPER_SHA256" \
    "runtimeTablePolicySha256=$RUNTIME_TABLE_POLICY_SHA256"
} | sha256sum | awk '{print $1}')"

VERIFY_ID="$(date -u +%Y%m%dT%H%M%SZ)"
TEMP_DB="resume_ai_restore_${VERIFY_ID,,}_$$"
TEMP_DB=${TEMP_DB//[^a-z0-9_]/_}
START_EPOCH=$(date +%s)
database_created=0
EVIDENCE_TEMP=""
RESTORE_JOURNAL_ACTIVE=0

write_restore_journal() {
  local phase=$1
  local journal_temp
  case "$phase" in prepared|database_created|database_dropped|evidence_published|failed) ;;
    *) fail "invalid restore transaction phase" ;;
  esac
  journal_temp="$(mktemp "$VERIFY_ROOT/.restore-journal.XXXXXX")"
  cat > "$journal_temp" <<EOF
SCHEMA=1
VERIFY_ID=$VERIFY_ID
TEMP_DB=$TEMP_DB
BACKUP_ID=${LATEST_BACKUP##*/}
ACTIVE_RELEASE=$ACTIVE_RELEASE
CONTRACT_SHA256=$CURRENT_CONTRACT_SHA256
PHASE=$phase
EOF
  chown root:root "$journal_temp"
  chmod 0600 "$journal_temp"
  sync -f "$journal_temp"
  mv -T -f -- "$journal_temp" "$RESTORE_PENDING"
  sync -f "$VERIFY_ROOT"
  RESTORE_JOURNAL_ACTIVE=1
}

write_restore_journal prepared

cleanup_database() {
  local exit_status=$?
  trap - EXIT
  if [ "$database_created" -eq 1 ]; then
    if postgres_peer dropdb --if-exists --force "$TEMP_DB" >/dev/null 2>&1; then
      database_created=0
      if [ "$RESTORE_JOURNAL_ACTIVE" -eq 1 ]; then
        write_restore_journal failed >/dev/null 2>&1 || true
      fi
    fi
  fi
  if [[ "${EVIDENCE_TEMP:-}" == /var/backups/resume-ai/postgresql/restore-verifications/.verification.* ]] \
    && [ -f "$EVIDENCE_TEMP" ] && [ ! -L "$EVIDENCE_TEMP" ]; then
    rm -f -- "$EVIDENCE_TEMP"
  fi
  exit "$exit_status"
}
trap cleanup_database EXIT

peer_contract="$(postgres_peer psql --dbname="$DB_NAME" --no-psqlrc --tuples-only --no-align \
  --field-separator=$'\t' --command="SELECT inet_server_addr() IS NULL,
    current_setting('data_directory'), (pg_control_system()).system_identifier::text,
    current_setting('data_checksums');")"
IFS=$'\t' read -r peer_is_local peer_data_dir peer_system_id peer_data_checksums <<< "$peer_contract"
[ "$peer_is_local" = t ] && [[ "$peer_data_dir" =~ ^/var/lib/postgresql/[0-9]+/main$ ]] \
  && [[ "$peer_system_id" =~ ^[0-9]{10,}$ ]] && [ "$peer_data_checksums" = on ] \
  || fail "restore verification is not bound to the approved local peer cluster"
[ "$peer_system_id" = "${backup_manifest[SYSTEM_IDENTIFIER]}" ] \
  || fail "restore source belongs to a different PostgreSQL cluster"
available_bytes="$(df --output=avail -B1 "$peer_data_dir" | awk 'NR==2 {print $1}')"
required_restore_bytes=$(( ${backup_manifest[DATABASE_SIZE_BYTES]} * 2 + 2147483648 ))
[[ "$available_bytes" =~ ^[0-9]+$ ]] && [ "$available_bytes" -ge "$required_restore_bytes" ] \
  || fail "insufficient PostgreSQL filesystem headroom for a disposable restore"

postgres_peer createdb --template=template0 "$TEMP_DB"
database_created=1
write_restore_journal database_created
postgres_peer pg_restore --exit-on-error \
  --dbname="$TEMP_DB" "$LATEST_BACKUP/database.dump"
PUBLIC_TABLES="$(postgres_peer psql --dbname="$TEMP_DB" --no-psqlrc --tuples-only --no-align \
  --command="SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public';")"
case "$PUBLIC_TABLES" in *[!0-9]*) fail "restore verification returned an invalid table count" ;; esac
[ "$PUBLIC_TABLES" -gt 0 ] || fail "restored database contains no public tables"

for contract_file in "$IDENTITY_READER" "$TABLE_POLICY" "$FUNCTION_POLICY"; do
  [ -f "$contract_file" ] && [ ! -L "$contract_file" ] || fail "restore authorization contract is missing"
  case "$contract_file" in
    "$IDENTITY_READER") expected_contract_stat=root:root:755:1 ;;
    *) expected_contract_stat=root:root:644:1 ;;
  esac
  [ "$(stat -c '%U:%G:%a:%h' "$contract_file")" = "$expected_contract_stat" ] \
    || fail "restore authorization contract has unsafe ownership, mode, or links"
done
runtime_identity="$($IDENTITY_READER)" || fail "cannot identify the approved runtime database role"
RUNTIME_ROLE=${runtime_identity%%$'\t'*}
identity_database=${runtime_identity#*$'\t'}
[ "$identity_database" = "$DB_NAME" ] || fail "restore and runtime database identities differ"
[[ "$RUNTIME_ROLE" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "restore runtime role is invalid"
OWNER_ROLE="${RUNTIME_ROLE}_owner"
[[ "$OWNER_ROLE" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "restore owner role is invalid"
python3 - "$LATEST_BACKUP/globals.sql" "$RUNTIME_ROLE" "$OWNER_ROLE" <<'PY' \
  || fail "globals backup does not preserve the exact runtime/owner role contract"
import pathlib
import re
import sys

source = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
runtime, owner = map(re.escape, sys.argv[2:])
if not re.search(rf"(?m)^CREATE ROLE {runtime};$", source):
    raise SystemExit(1)
runtime_alter = re.search(rf"(?m)^ALTER ROLE {runtime} WITH (.+);$", source)
if not runtime_alter or not all(token in runtime_alter.group(1).split() for token in (
    "NOSUPERUSER", "NOCREATEDB", "NOCREATEROLE", "NOINHERIT", "LOGIN", "NOREPLICATION", "NOBYPASSRLS"
)) or not re.search(r"PASSWORD 'SCRAM-SHA-256\$", runtime_alter.group(1)):
    raise SystemExit(2)
if not re.search(rf"(?m)^CREATE ROLE {owner};$", source):
    raise SystemExit(3)
owner_alter = re.search(rf"(?m)^ALTER ROLE {owner} WITH (.+);$", source)
if not owner_alter or not all(token in owner_alter.group(1).split() for token in (
    "NOSUPERUSER", "NOCREATEDB", "NOCREATEROLE", "NOINHERIT", "NOLOGIN", "NOREPLICATION", "NOBYPASSRLS"
)) or "PASSWORD" in owner_alter.group(1):
    raise SystemExit(4)
PY

allowed_tables=""
restored_table_policy_count=0
while IFS='=' read -r table_name privilege_list || [ -n "$table_name" ]; do
  case "$table_name" in ''|'#'*) continue ;; esac
  [[ "$table_name" =~ ^[a-z][a-z0-9_]*$ ]] \
    && [[ "$privilege_list" =~ ^(SELECT|INSERT|UPDATE)(,(SELECT|INSERT|UPDATE))*$ ]] \
    || fail "restore table privilege policy is malformed"
  [ -z "$allowed_tables" ] || allowed_tables+=","
  allowed_tables+="'$table_name'"
  owner_gate="$(postgres_peer psql --dbname="$TEMP_DB" --no-psqlrc --tuples-only --no-align --command="
    SELECT count(*)=1 AND bool_and(pg_get_userbyid(c.relowner)='$OWNER_ROLE')
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='$table_name' AND c.relkind IN ('r','p');")"
  [ "$owner_gate" = t ] || fail "restored table owner differs from the protected contract: $table_name"
  for privilege in SELECT INSERT UPDATE; do
    case ",$privilege_list," in *",$privilege,"*) expected_privilege=t ;; *) expected_privilege=f ;; esac
    actual_privilege="$(postgres_peer psql --dbname="$TEMP_DB" --no-psqlrc --tuples-only --no-align --command="
      SELECT has_table_privilege('$RUNTIME_ROLE','public.$table_name','$privilege');")"
    [ "$actual_privilege" = "$expected_privilege" ] \
      || fail "restored runtime $privilege ACL differs for $table_name"
  done
  forbidden_acl="$(postgres_peer psql --dbname="$TEMP_DB" --no-psqlrc --tuples-only --no-align --command="
    SELECT has_table_privilege('$RUNTIME_ROLE','public.$table_name','DELETE')
      OR has_table_privilege('$RUNTIME_ROLE','public.$table_name','TRUNCATE')
      OR has_table_privilege('$RUNTIME_ROLE','public.$table_name','REFERENCES')
      OR has_table_privilege('$RUNTIME_ROLE','public.$table_name','TRIGGER');")"
  [ "$forbidden_acl" = f ] || fail "restored runtime has a forbidden table ACL on $table_name"
  restored_table_policy_count=$((restored_table_policy_count + 1))
done < "$TABLE_POLICY"
[ "$restored_table_policy_count" -gt 0 ] || fail "restore table policy is empty"

restored_function_policy_count=0
allowed_function_sql=""
while IFS='=' read -r function_name function_signature || [ -n "$function_name" ]; do
  case "$function_name" in ''|'#'*) continue ;; esac
  [[ "$function_name" =~ ^[a-z][a-z0-9_]*$ ]] \
    && [[ "$function_signature" =~ ^$|^(text|uuid)(,(text|uuid))*$ ]] \
    || fail "restore function privilege policy is malformed"
  [ -z "$allowed_function_sql" ] || allowed_function_sql+=" OR "
  allowed_function_sql+="(p.proname='$function_name' AND replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')='$function_signature')"
  function_gate="$(postgres_peer psql --dbname="$TEMP_DB" --no-psqlrc --tuples-only --no-align --command="
    SELECT count(*)=1 AND bool_and(pg_get_userbyid(p.proowner)='$OWNER_ROLE'
      AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
      AND has_function_privilege('$RUNTIME_ROLE',p.oid,'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
      ))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='$function_name'
      AND replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')='$function_signature';")"
  [ "$function_gate" = t ] || fail "restored owner/ACL contract failed for $function_name($function_signature)"
  restored_function_policy_count=$((restored_function_policy_count + 1))
done < "$FUNCTION_POLICY"
[ "$restored_function_policy_count" = 7 ] || fail "restore function policy must contain exactly seven RPCs"
unexpected_runtime_functions="$(postgres_peer psql --dbname="$TEMP_DB" --no-psqlrc --tuples-only --no-align --command="
  SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND has_function_privilege('$RUNTIME_ROLE',p.oid,'EXECUTE')
    AND NOT ((p.proname='gen_random_uuid' AND pg_get_function_identity_arguments(p.oid)='')
      OR $allowed_function_sql);")"
[ "$unexpected_runtime_functions" = 0 ] || fail "restored runtime can execute unapproved functions"

[ -f "$REQUIRED_TABLE_FILE" ] && [ ! -L "$REQUIRED_TABLE_FILE" ] \
  || fail "required-table policy is missing or unsafe"
[ "$(stat -c '%U:%G:%a:%h' "$REQUIRED_TABLE_FILE")" = "root:root:644:1" ] \
  || fail "required-table policy has unsafe ownership or permissions"
required_table_count=0
while IFS= read -r required_table || [ -n "$required_table" ]; do
  case "$required_table" in ''|'#'*) continue ;; esac
  [[ "$required_table" =~ ^[a-z][a-z0-9_]*$ ]] || fail "invalid required table name"
  table_present="$(postgres_peer psql --dbname="$TEMP_DB" --no-psqlrc --tuples-only --no-align \
    --command="SELECT to_regclass('public.$required_table') IS NOT NULL;")"
  [ "$table_present" = t ] || fail "required restored table is missing: $required_table"
  required_table_count=$((required_table_count + 1))
done < "$REQUIRED_TABLE_FILE"
[ "$required_table_count" -gt 0 ] || fail "required-table policy is empty"

INVALID_INDEXES="$(postgres_peer psql --dbname="$TEMP_DB" --no-psqlrc --tuples-only --no-align \
  --command="SELECT count(*) FROM pg_catalog.pg_index WHERE NOT indisvalid OR NOT indisready;")"
UNVALIDATED_CONSTRAINTS="$(postgres_peer psql --dbname="$TEMP_DB" --no-psqlrc --tuples-only --no-align \
  --command="SELECT count(*) FROM pg_catalog.pg_constraint WHERE NOT convalidated;")"
MIGRATION_ROWS="$(postgres_peer psql --dbname="$TEMP_DB" --no-psqlrc --tuples-only --no-align \
  --command="SELECT count(*) FROM resume_ai_schema_migrations WHERE migration_mode='expand' AND migration_sha256 ~ '^[a-f0-9]{64}$';")"
LEDGER_TOTAL="$(postgres_peer psql --dbname="$TEMP_DB" --no-psqlrc --tuples-only --no-align \
  --command="SELECT count(*) FROM resume_ai_schema_migrations;")"
[ "$INVALID_INDEXES" = 0 ] || fail "restored database contains invalid indexes"
[ "$UNVALIDATED_CONSTRAINTS" = 0 ] || fail "restored database contains unvalidated constraints"
[[ "$MIGRATION_ROWS" =~ ^[0-9]+$ ]] && [ "$MIGRATION_ROWS" -gt 0 ] \
  || fail "restored migration ledger is empty or malformed"

[ "$(readlink -e /opt/resume-ai/current)" = "$ACTIVE_ROOT" ] \
  || fail "active release changed during restore verification"
[ -f "$MIGRATION_POLICY" ] && [ ! -L "$MIGRATION_POLICY" ] \
  || fail "active migration manifest is missing or unsafe"
manifest_migration_count=0
declare -A restored_migrations=()
while read -r migration_hash migration_name migration_mode extra; do
  case "$migration_hash" in ''|'#'*) continue ;; esac
  [ -z "${extra:-}" ] && [[ "$migration_hash" =~ ^[a-f0-9]{64}$ ]] \
    && [[ "$migration_name" =~ ^[0-9]{8}_[a-z0-9_]+\.sql$ ]] && [ "$migration_mode" = expand ] \
    || fail "active migration manifest is malformed"
  [ -z "${restored_migrations[$migration_name]:-}" ] || fail "duplicate active migration declaration"
  restored_migrations[$migration_name]=1
  migration_path="$ACTIVE_ROOT/db/migrations/$migration_name"
  [ -f "$migration_path" ] && [ ! -L "$migration_path" ] \
    && [ "$(sha256sum "$migration_path" | awk '{print $1}')" = "$migration_hash" ] \
    || fail "active migration source differs from its manifest: $migration_name"
  if [ "$migration_name" = 20260826_runtime_delete_functions.sql ]; then
    [ "$migration_hash" = 8f60e9129bb9bd3e74a2880383f05f3b8b4fd392cd74939fb9e4cf1e3463f2eb ] \
      || fail "reviewed runtime RPC migration hash is not the frozen contract"
    /usr/local/lib/resume-ai/validate-reviewed-migration.py "$migration_path"
  else
    /usr/local/lib/resume-ai/validate-expand-migration.py "$migration_path"
  fi
  ledger_match="$(postgres_peer psql --dbname="$TEMP_DB" --no-psqlrc --tuples-only --no-align \
    --command="SELECT count(*) FROM resume_ai_schema_migrations
      WHERE migration_name='$migration_name' AND migration_sha256='$migration_hash'
        AND migration_mode='expand';")"
  [ "$ledger_match" = 1 ] || fail "restored ledger does not bind $migration_name to its approved hash"
  manifest_migration_count=$((manifest_migration_count + 1))
done < "$MIGRATION_POLICY"
[ "$manifest_migration_count" -gt 0 ] && [ "$MIGRATION_ROWS" -eq "$manifest_migration_count" ] \
  && [ "$LEDGER_TOTAL" -eq "$manifest_migration_count" ] \
  || fail "restored migration ledger and active manifest are not an exact set"

read -r verification_hash verification_name execution_identity verification_extra < <(
  awk '!/^($|#)/ { print }' "$VERIFICATION_POLICY"
)
[ -z "${verification_extra:-}" ] && [[ "$verification_hash" =~ ^[a-f0-9]{64}$ ]] \
  && [ "$verification_name" = verify-production-database-readonly.sql ] \
  && [ "$execution_identity" = readonly-peer-v1 ] \
  && [ "$(awk '!/^($|#)/ { count += 1 } END { print count + 0 }' "$VERIFICATION_POLICY")" -eq 1 ] \
  && [ "$(sha256sum "$READONLY_DATABASE_SQL" | awk '{print $1}')" = "$verification_hash" ] \
  || fail "fixed read-only database verification manifest is malformed"
# Restore verification uses the same root-installed, hash-bound catalog SQL.
# The restored database is disposable, but the session is still forced read
# only so no candidate-controlled SQL or restored routine can mutate it here.
runuser -u postgres -- env -i PATH=/usr/bin:/bin PGHOST=/var/run/postgresql \
  PGUSER=postgres PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30s -c lock_timeout=5s' \
  psql --dbname="$TEMP_DB" --no-psqlrc --set=ON_ERROR_STOP=1 \
    --set=expected_session=postgres --file="$READONLY_DATABASE_SQL" >/dev/null
verified_sql_count=1
[ "$(readlink -e /opt/resume-ai/current)" = "$ACTIVE_ROOT" ] \
  || fail "active release changed during restore verification"
postgres_peer dropdb --force "$TEMP_DB"
database_created=0
write_restore_journal database_dropped
END_EPOCH=$(date +%s)
ELAPSED_SECONDS=$((END_EPOCH - START_EPOCH))
[ "$ELAPSED_SECONDS" -le "$RTO_SECONDS" ] \
  || fail "restore exceeded the ${RTO_SECONDS}s RTO"

VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
verify_id_epoch="$(date -u -d "${VERIFY_ID:0:4}-${VERIFY_ID:4:2}-${VERIFY_ID:6:2} ${VERIFY_ID:9:2}:${VERIFY_ID:11:2}:${VERIFY_ID:13:2}Z" +%s 2>/dev/null)" \
  || fail "generated restore verification ID is invalid"
verified_epoch="$(date -d "$VERIFIED_AT" +%s 2>/dev/null)" \
  || fail "generated restore verification timestamp is invalid"
verification_span=$((verified_epoch - verify_id_epoch))
[ $(( $(date +%s) - verify_id_epoch )) -ge -300 ] \
  && [ $(( $(date +%s) - verified_epoch )) -ge -300 ] \
  && [ "$verification_span" -ge 0 ] \
  && [ "$verification_span" -le $((RTO_SECONDS + 300)) ] \
  || fail "generated restore evidence ID and internal timestamp are inconsistent"
EVIDENCE_FINAL="$VERIFY_ROOT/$VERIFY_ID.json"
[ ! -e "$EVIDENCE_FINAL" ] && [ ! -L "$EVIDENCE_FINAL" ] \
  || fail "restore verification evidence ID already exists"
EVIDENCE_TEMP="$(mktemp "$VERIFY_ROOT/.verification.XXXXXX")"
cat > "$EVIDENCE_TEMP" <<EOF
{
  "schemaVersion": 3,
  "verificationId": "$VERIFY_ID",
  "verifiedAt": "$VERIFIED_AT",
  "backup": "${LATEST_BACKUP##*/}",
  "backupCreatedAt": "${backup_manifest[CREATED_AT]}",
  "databaseName": "$DB_NAME",
  "backupDatabaseDumpSha256": "$BACKUP_DUMP_SHA256",
  "backupGlobalsSha256": "$BACKUP_GLOBALS_SHA256",
  "backupArchiveListSha256": "$BACKUP_ARCHIVE_LIST_SHA256",
  "backupManifestSha256": "$BACKUP_MANIFEST_SHA256",
  "backupChecksumsSha256": "$BACKUP_CHECKSUMS_SHA256",
  "backupWriterSha256": "$BACKUP_WRITER_SHA256",
  "backupInspectorSha256": "$BACKUP_INSPECTOR_CURRENT_SHA256",
  "retentionSelectorSha256": "$RETENTION_SELECTOR_CURRENT_SHA256",
  "backupConfigSha256": "$BACKUP_CONFIG_SHA256",
  "restoreVerifierSha256": "$RESTORE_VERIFIER_SHA256",
  "evidenceVerifierSha256": "$EVIDENCE_VERIFIER_SHA256",
  "activeRelease": "$ACTIVE_RELEASE",
  "migrationManifestSha256": "$MIGRATION_MANIFEST_SHA256",
  "databaseVerificationManifestSha256": "$DATABASE_VERIFICATION_MANIFEST_SHA256",
  "runtimeTablePolicySha256": "$RUNTIME_TABLE_POLICY_SHA256",
  "runtimeFunctionPolicySha256": "$RUNTIME_FUNCTION_POLICY_SHA256",
  "requiredTablesPolicySha256": "$REQUIRED_TABLES_POLICY_SHA256",
  "runtimeIdentityHelperSha256": "$RUNTIME_IDENTITY_HELPER_SHA256",
  "contractSha256": "$CURRENT_CONTRACT_SHA256",
  "postgresSystemIdentifier": "$peer_system_id",
  "temporaryDatabaseDropped": true,
  "publicTableCount": $PUBLIC_TABLES,
  "requiredTableCount": $required_table_count,
  "restoredTablePolicyCount": $restored_table_policy_count,
  "restoredFunctionPolicyCount": $restored_function_policy_count,
  "validExpandMigrationCount": $MIGRATION_ROWS,
  "manifestMigrationCount": $manifest_migration_count,
  "verifiedSqlCount": $verified_sql_count,
  "invalidIndexCount": $INVALID_INDEXES,
  "unvalidatedConstraintCount": $UNVALIDATED_CONSTRAINTS,
  "elapsedSeconds": $ELAPSED_SECONDS,
  "rtoSeconds": $RTO_SECONDS,
  "ok": true
}
EOF
chown root:root "$EVIDENCE_TEMP"
chmod 0600 "$EVIDENCE_TEMP"
sync -f "$EVIDENCE_TEMP"
[ "$(readlink -e /opt/resume-ai/current)" = "$ACTIVE_ROOT" ] \
  || fail "active release changed before restore evidence publication"
python3 "$EVIDENCE_VERIFIER" \
  --evidence "$EVIDENCE_TEMP" \
  --expected-id "$VERIFY_ID" \
  --daily-root "$BACKUP_ROOT/daily" \
  --active-root "$ACTIVE_ROOT" \
  --config "$CONFIG_FILE" \
  --database "$DB_NAME" \
  --system-identifier "$peer_system_id" \
  --require-retained >/dev/null
mv -- "$EVIDENCE_TEMP" "$EVIDENCE_FINAL"
EVIDENCE_TEMP=""
sync -f "$VERIFY_ROOT"
python3 "$EVIDENCE_VERIFIER" \
  --evidence "$EVIDENCE_FINAL" \
  --expected-id "$VERIFY_ID" \
  --daily-root "$BACKUP_ROOT/daily" \
  --active-root "$ACTIVE_ROOT" \
  --config "$CONFIG_FILE" \
  --database "$DB_NAME" \
  --system-identifier "$peer_system_id" \
  --require-retained >/dev/null
write_restore_journal evidence_published
rm -f -- "$RESTORE_PENDING"
sync -f "$VERIFY_ROOT"
RESTORE_JOURNAL_ACTIVE=0
trap - EXIT
printf '%s\n' "Restore verification passed in $ELAPSED_SECONDS seconds; temporary database removed."
