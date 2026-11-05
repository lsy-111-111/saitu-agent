#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
MODE=${1:-}
case "$MODE" in
  reconcile|verify) [ "$#" -eq 1 ] || fail "unexpected argument" ;;
  rollback) [ "$#" -eq 2 ] || fail "rollback requires its protected backup directory" ;;
  *) fail "usage: provision-postgres-maintenance-role.sh reconcile|verify|rollback BACKUP_DIR" ;;
esac
if [ "$MODE" = reconcile ]; then
  [ "${ACK_POSTGRES_MAINTENANCE:-}" = YES ] \
    || fail "set ACK_POSTGRES_MAINTENANCE=YES after the protected database backup exists"
elif [ "$MODE" = rollback ]; then
  [ "${ACK_POSTGRES_MAINTENANCE_ROLLBACK:-}" = YES ] \
    || fail "explicit maintenance-role rollback acknowledgement is required"
fi

IDENTITY_READER=/usr/local/lib/resume-ai/read-postgres-runtime-identity.sh
for protected_file in "$IDENTITY_READER" /etc/resume-ai/runtime-table-privileges.conf; do
  [ -f "$protected_file" ] && [ ! -L "$protected_file" ] \
    || fail "trusted database control is missing or unsafe: $protected_file"
  case "$protected_file" in
    /etc/resume-ai/runtime-table-privileges.conf)
      [ "$(stat -c '%U:%G:%a:%h' "$protected_file")" = root:root:644:1 ] ;;
    *) [ "$(stat -c '%U:%G:%a:%h' "$protected_file")" = root:root:755:1 ] ;;
  esac || fail "trusted database control has unsafe ownership, mode, or links: $protected_file"
done
database_identity="$($IDENTITY_READER)" || fail "cannot identify the approved local database"
runtime_role=${database_identity%%$'\t'*}
DATABASE_NAME=${database_identity#*$'\t'}
[[ "$runtime_role" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "runtime database role is invalid"
[[ "$DATABASE_NAME" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "runtime database name is invalid"
unset database_identity runtime_role

MAINTENANCE_ROLE=resume_ai_security_maintenance
cleanup_tables=(
  ai_consents
  ai_model_call_leases
  ai_model_call_waiters
  competition_idempotency
  competition_rate_limit_counters
  competition_session_starts
  competition_session_transitions
  competition_sessions
)
declare -A cleanup_lock_columns=(
  [ai_consents]=created_at
  [ai_model_call_leases]=expires_at
  [ai_model_call_waiters]=expires_at
  [competition_idempotency]=expires_at
  [competition_rate_limit_counters]=reset_at
  [competition_session_starts]=expires_at
  [competition_session_transitions]=expires_at
  [competition_sessions]=expires_at
)

open_root_lock 9 postgres-role-hardening

psql_admin() {
  runuser -u postgres -- env -i PATH=/usr/bin:/bin PGHOST=/var/run/postgresql PGUSER=postgres \
    psql --dbname="$DATABASE_NAME" --no-psqlrc --set=ON_ERROR_STOP=1 "$@"
}

verify_role() {
  local column_mode=${1:-exact}
  case "$column_mode" in exact|legacy-without-lock-columns) ;; *) fail "invalid maintenance verification mode" ;; esac
  local role_gate allowed_tables="" table_name privilege privilege_gate unexpected direct_functions
  local lock_column column_grant_count
  role_gate="$(psql_admin --tuples-only --no-align --command="
    SELECT count(*)=1 AND bool_and(
      NOT r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper
      AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
      AND NOT r.rolbypassrls
      AND NOT has_database_privilege(r.rolname, '$DATABASE_NAME', 'CONNECT')
      AND NOT has_database_privilege(r.rolname, '$DATABASE_NAME', 'CREATE')
      AND NOT has_database_privilege(r.rolname, '$DATABASE_NAME', 'TEMP')
      AND has_schema_privilege(r.rolname, 'public', 'USAGE')
      AND NOT has_schema_privilege(r.rolname, 'public', 'CREATE')
      AND NOT EXISTS (
        SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid
      )
      AND NOT EXISTS (SELECT 1 FROM pg_database d WHERE d.datdba=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspowner=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proowner=r.oid)
    ) FROM pg_roles r WHERE r.rolname='$MAINTENANCE_ROLE';")"
  [ "$role_gate" = t ] || fail "maintenance role is missing, privileged, or owns database objects"

  for table_name in "${cleanup_tables[@]}"; do
    [ -z "$allowed_tables" ] || allowed_tables+=","
    allowed_tables+="'$table_name'"
    for privilege in SELECT DELETE; do
      privilege_gate="$(psql_admin --tuples-only --no-align --command="
        SELECT to_regclass('public.$table_name') IS NOT NULL
          AND has_table_privilege('$MAINTENANCE_ROLE', 'public.$table_name', '$privilege');")"
      [ "$privilege_gate" = t ] || fail "maintenance $privilege grant is missing for $table_name"
    done
    for privilege in INSERT UPDATE TRUNCATE REFERENCES TRIGGER; do
      privilege_gate="$(psql_admin --tuples-only --no-align --command="
        SELECT NOT has_table_privilege('$MAINTENANCE_ROLE', 'public.$table_name', '$privilege');")"
      [ "$privilege_gate" = t ] || fail "maintenance role has unapproved $privilege on $table_name"
    done
    lock_column=${cleanup_lock_columns[$table_name]}
    privilege_gate="$(psql_admin --tuples-only --no-align --command="
      SELECT has_column_privilege('$MAINTENANCE_ROLE', 'public.$table_name', '$lock_column', 'UPDATE');")"
    if [ "$column_mode" = exact ]; then
      [ "$privilege_gate" = t ] \
        || fail "maintenance row-lock UPDATE grant is missing for $table_name.$lock_column"
    else
      [ "$privilege_gate" = f ] \
        || fail "legacy maintenance role has an unexpected partial UPDATE grant"
    fi
  done
  column_grant_count="$(psql_admin --tuples-only --no-align --command="
    SELECT count(*) FROM information_schema.column_privileges
    WHERE grantee='$MAINTENANCE_ROLE' AND privilege_type='UPDATE'
      AND (table_schema, table_name, column_name) IN (VALUES
        ('public','ai_consents','created_at'),
        ('public','ai_model_call_leases','expires_at'),
        ('public','ai_model_call_waiters','expires_at'),
        ('public','competition_idempotency','expires_at'),
        ('public','competition_rate_limit_counters','reset_at'),
        ('public','competition_session_starts','expires_at'),
        ('public','competition_session_transitions','expires_at'),
        ('public','competition_sessions','expires_at'));")"
  if [ "$column_mode" = exact ]; then
    [ "$column_grant_count" = 8 ] || fail "maintenance row-lock column grants are incomplete"
  else
    [ "$column_grant_count" = 0 ] || fail "legacy maintenance role has unexpected row-lock grants"
  fi
  unexpected="$(psql_admin --tuples-only --no-align --command="
    SELECT count(*) FROM information_schema.column_privileges
    WHERE grantee='$MAINTENANCE_ROLE' AND privilege_type='UPDATE'
      AND (table_schema, table_name, column_name) NOT IN (VALUES
        ('public','ai_consents','created_at'),
        ('public','ai_model_call_leases','expires_at'),
        ('public','ai_model_call_waiters','expires_at'),
        ('public','competition_idempotency','expires_at'),
        ('public','competition_rate_limit_counters','reset_at'),
        ('public','competition_session_starts','expires_at'),
        ('public','competition_session_transitions','expires_at'),
        ('public','competition_sessions','expires_at'));")"
  [ "$unexpected" = 0 ] || fail "maintenance role has unapproved UPDATE on $unexpected columns"
  unexpected="$(psql_admin --tuples-only --no-align --command="
    SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')
      AND c.relname NOT IN ($allowed_tables)
      AND (has_table_privilege('$MAINTENANCE_ROLE', c.oid, 'SELECT')
        OR has_table_privilege('$MAINTENANCE_ROLE', c.oid, 'INSERT')
        OR has_table_privilege('$MAINTENANCE_ROLE', c.oid, 'UPDATE')
        OR has_table_privilege('$MAINTENANCE_ROLE', c.oid, 'DELETE')
        OR has_table_privilege('$MAINTENANCE_ROLE', c.oid, 'TRUNCATE')
        OR has_table_privilege('$MAINTENANCE_ROLE', c.oid, 'REFERENCES')
        OR has_table_privilege('$MAINTENANCE_ROLE', c.oid, 'TRIGGER'));")"
  [ "$unexpected" = 0 ] || fail "maintenance role can access $unexpected non-retention relations"
  direct_functions="$(psql_admin --tuples-only --no-align --command="
    SELECT count(*) FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    WHERE acl.grantee=(SELECT oid FROM pg_roles WHERE rolname='$MAINTENANCE_ROLE');")"
  [ "$direct_functions" = 0 ] || fail "maintenance role has direct function grants"
}

if [ "$MODE" = verify ]; then
  verify_role
  printf '%s\n' "PostgreSQL security-state maintenance authorization verification passed."
  exit 0
fi

if [ "$MODE" = rollback ]; then
  BACKUP_DIR=$2
  case "$BACKUP_DIR" in
    /var/backups/resume-ai/postgresql/maintenance-role/20??????T??????Z) ;;
    *) fail "unsafe maintenance-role backup path" ;;
  esac
  for protected in rollback.sql SHA256SUMS; do
    [ -f "$BACKUP_DIR/$protected" ] && [ ! -L "$BACKUP_DIR/$protected" ] \
      && [ "$(stat -c '%U:%G:%a:%h' "$BACKUP_DIR/$protected")" = root:root:600:1 ] \
      || fail "protected maintenance rollback artifact is missing or unsafe: $protected"
  done
  (cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS >/dev/null)
  psql_admin --single-transaction --file="$BACKUP_DIR/rollback.sql" >/dev/null
  printf '%s\n' "Rolled back the dedicated maintenance role from $BACKUP_DIR."
  exit 0
fi

role_count="$(psql_admin --tuples-only --no-align --command="SELECT count(*) FROM pg_roles WHERE rolname='$MAINTENANCE_ROLE';")"
if [ "$role_count" = 1 ]; then
  if (verify_role exact >/dev/null 2>&1); then
    printf '%s\n' "PostgreSQL security-state maintenance role is already exact."
    exit 0
  fi
  verify_role legacy-without-lock-columns
  UPGRADE_LEGACY_ROLE=1
else
  UPGRADE_LEGACY_ROLE=0
fi
[ "$role_count" = 0 ] || [ "$UPGRADE_LEGACY_ROLE" -eq 1 ] \
  || fail "maintenance role identity is ambiguous"
for table_name in "${cleanup_tables[@]}"; do
  exists="$(psql_admin --tuples-only --no-align --command="SELECT to_regclass('public.$table_name') IS NOT NULL;")"
  [ "$exists" = t ] || fail "required retention table does not exist: $table_name"
done

BACKUP_ROOT=/var/backups/resume-ai/postgresql/maintenance-role
BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
[ ! -e "$BACKUP_DIR" ] || fail "maintenance-role backup directory already exists"
install -d -o root -g root -m 0700 "$BACKUP_ROOT" "$BACKUP_DIR"
if [ "$UPGRADE_LEGACY_ROLE" -eq 1 ]; then
  : > "$BACKUP_DIR/rollback.sql"
  : > "$BACKUP_DIR/apply.sql"
  for table_name in "${cleanup_tables[@]}"; do
    printf 'REVOKE UPDATE (%s) ON TABLE public.%s FROM "%s";\n' \
      "${cleanup_lock_columns[$table_name]}" "$table_name" "$MAINTENANCE_ROLE" \
      >> "$BACKUP_DIR/rollback.sql"
    printf 'GRANT UPDATE (%s) ON TABLE public.%s TO "%s";\n' \
      "${cleanup_lock_columns[$table_name]}" "$table_name" "$MAINTENANCE_ROLE" \
      >> "$BACKUP_DIR/apply.sql"
  done
else
cat > "$BACKUP_DIR/rollback.sql" <<EOF
DROP OWNED BY "$MAINTENANCE_ROLE";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "$MAINTENANCE_ROLE";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "$MAINTENANCE_ROLE";
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM "$MAINTENANCE_ROLE";
REVOKE ALL PRIVILEGES ON SCHEMA public FROM "$MAINTENANCE_ROLE";
REVOKE ALL PRIVILEGES ON DATABASE "$DATABASE_NAME" FROM "$MAINTENANCE_ROLE";
DROP ROLE "$MAINTENANCE_ROLE";
EOF

cat > "$BACKUP_DIR/apply.sql" <<EOF
CREATE ROLE "$MAINTENANCE_ROLE" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
REVOKE ALL PRIVILEGES ON DATABASE "$DATABASE_NAME" FROM "$MAINTENANCE_ROLE";
REVOKE ALL PRIVILEGES ON SCHEMA public FROM "$MAINTENANCE_ROLE";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "$MAINTENANCE_ROLE";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "$MAINTENANCE_ROLE";
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM "$MAINTENANCE_ROLE";
GRANT USAGE ON SCHEMA public TO "$MAINTENANCE_ROLE";
EOF
for table_name in "${cleanup_tables[@]}"; do
  printf 'GRANT SELECT,DELETE ON TABLE public.%s TO "%s";\n' \
    "$table_name" "$MAINTENANCE_ROLE" >> "$BACKUP_DIR/apply.sql"
  printf 'GRANT UPDATE (%s) ON TABLE public.%s TO "%s";\n' \
    "${cleanup_lock_columns[$table_name]}" "$table_name" "$MAINTENANCE_ROLE" \
    >> "$BACKUP_DIR/apply.sql"
done
fi
chmod 0600 "$BACKUP_DIR/rollback.sql" "$BACKUP_DIR/apply.sql"
(cd "$BACKUP_DIR" && sha256sum rollback.sql apply.sql > SHA256SUMS)
chmod 0600 "$BACKUP_DIR/SHA256SUMS"
sync -f "$BACKUP_DIR/rollback.sql"
sync -f "$BACKUP_DIR/apply.sql"
sync -f "$BACKUP_DIR/SHA256SUMS"
sync -f "$BACKUP_DIR"
psql_admin --single-transaction --file="$BACKUP_DIR/apply.sql" >/dev/null
verify_role
printf 'status=completed\nrole=%s\n' "$MAINTENANCE_ROLE" > "$BACKUP_DIR/RESULT"
chmod 0600 "$BACKUP_DIR/RESULT"
sync -f "$BACKUP_DIR/RESULT"
sync -f "$BACKUP_DIR"
printf '%s\n' "Created exact NOLOGIN security-state maintenance role; rollback: $BACKUP_DIR"
