#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
MODE=${1:-}
LEGACY_TARGET_RELEASE=none
case "$MODE" in
  prepare|reconcile|verify|verify-compat) [ "$#" -eq 1 ] || fail "unexpected argument" ;;
  grant-legacy-delete)
    [ "$#" -eq 2 ] || fail "grant-legacy-delete requires the target legacy release"
    LEGACY_TARGET_RELEASE=$2
    case "$LEGACY_TARGET_RELEASE" in 20??????T??????Z) ;; *) fail "invalid legacy target release" ;; esac
    ;;
  rollback) [ "$#" -eq 2 ] || fail "rollback requires its backup directory" ;;
  *) fail "usage: provision-postgres-runtime-role.sh prepare|reconcile|verify|verify-compat|grant-legacy-delete RELEASE|rollback BACKUP_DIR" ;;
esac
if [ "$MODE" = prepare ] || [ "$MODE" = reconcile ]; then
  [ "${ACK_POSTGRES_RUNTIME_HARDENING:-}" = YES ] \
    || fail "set ACK_POSTGRES_RUNTIME_HARDENING=YES after the protected backup exists"
fi
if [ "$MODE" = grant-legacy-delete ]; then
  [ "${ACK_POSTGRES_LEGACY_DELETE:-}" = YES ] \
    || fail "explicit legacy DELETE compatibility acknowledgement is required"
fi
if [ "$MODE" = rollback ]; then
  [ "${ACK_POSTGRES_RUNTIME_ROLLBACK:-}" = YES ] || fail "explicit runtime-role rollback acknowledgement is required"
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/open-root-lock.sh"
APP_ENV_READER=/usr/local/lib/resume-ai/validate-app-env.sh
BACKUP_CONFIG_READER=/usr/local/lib/resume-ai/read-backup-config.sh
IDENTITY_READER=/usr/local/lib/resume-ai/read-postgres-runtime-identity.sh
PRIVILEGE_POLICY=/etc/resume-ai/runtime-table-privileges.conf
FUNCTION_POLICY=/etc/resume-ai/runtime-function-privileges.conf
for protected_file in "$APP_ENV_READER" "$BACKUP_CONFIG_READER" "$IDENTITY_READER" "$PRIVILEGE_POLICY" "$FUNCTION_POLICY"; do
  [ -f "$protected_file" ] && [ ! -L "$protected_file" ] || fail "trusted database control is missing: $protected_file"
  [ "$(stat -c '%U:%G:%a:%h' "$protected_file")" = root:root:755:1 ] \
    || case "$protected_file" in
      "$PRIVILEGE_POLICY"|"$FUNCTION_POLICY")
        [ "$(stat -c '%U:%G:%a:%h' "$protected_file")" = root:root:644:1 ] \
          || fail "trusted database policy has unsafe ownership, mode, or links: $protected_file" ;;
      *) fail "trusted database control has unsafe ownership, mode, or links: $protected_file" ;;
    esac
done
database_identity="$($IDENTITY_READER)" \
  || fail "DATABASE_URL cannot identify an approved local runtime role and database"
RUNTIME_ROLE=${database_identity%%$'\t'*}
DATABASE_NAME=${database_identity#*$'\t'}
[[ "$RUNTIME_ROLE" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "runtime database role is invalid"
[[ "$DATABASE_NAME" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "runtime database name is invalid"
[ "$RUNTIME_ROLE" != postgres ] || fail "the application cannot run as postgres"
OWNER_ROLE="${RUNTIME_ROLE}_owner"
[[ "$OWNER_ROLE" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "derived owner role name is invalid"
if [ -f /etc/resume-ai/backup.env ]; then
  configured_database="$($BACKUP_CONFIG_READER get DB_NAME /etc/resume-ai/backup.env)"
  [ "$configured_database" = "$DATABASE_NAME" ] || fail "runtime URL and backup database disagree"
fi
unset database_identity

bind_installed_policies() {
  local expected_table=${EXPECTED_RUNTIME_TABLE_POLICY_SHA256:-}
  local expected_function=${EXPECTED_RUNTIME_FUNCTION_POLICY_SHA256:-}
  local state_file=/opt/resume-ai/state/database-permissions.env
  if [ -z "$expected_table$expected_function" ] && [ -f "$state_file" ] && [ ! -L "$state_file" ]; then
    [ "$(stat -c '%U:%G:%a:%h' "$state_file")" = root:resume-ai:640:1 ] \
      || fail "database permission state is unsafe"
    local state_contract="" state_table="" state_function="" state_key state_value
    while IFS='=' read -r state_key state_value || [ -n "$state_key" ]; do
      case "$state_key" in
        CONTRACT_STATUS) state_contract=$state_value ;;
        TABLE_POLICY_SHA256) state_table=$state_value ;;
        FUNCTION_POLICY_SHA256) state_function=$state_value ;;
        SCHEMA_VERSION|ACTIVE_RELEASE|DELETE_MODE|MIGRATIONS_MANIFEST_SHA256|UPDATED_AT) ;;
        *) fail "database permission state contains an unknown key" ;;
      esac
    done < "$state_file"
    if [ "$state_contract" = bound ]; then
      expected_table=$state_table
      expected_function=$state_function
    fi
  fi
  if [ -n "$expected_table$expected_function" ]; then
    [[ "$expected_table" =~ ^[a-f0-9]{64}$ ]] \
      && [[ "$expected_function" =~ ^[a-f0-9]{64}$ ]] \
      || fail "expected runtime policy hashes are malformed"
    [ "$(sha256sum "$PRIVILEGE_POLICY" | awk '{print $1}')" = "$expected_table" ] \
      && [ "$(sha256sum "$FUNCTION_POLICY" | awk '{print $1}')" = "$expected_function" ] \
      || fail "installed runtime policies differ from the active/release database contract"
  fi
}
bind_installed_policies

declare -A table_privileges=()
declare -A seen_tables=()
while IFS='=' read -r table_name privilege_list || [ -n "$table_name" ]; do
  case "$table_name" in ''|'#'*) continue ;; esac
  [[ "$table_name" =~ ^[a-z][a-z0-9_]*$ ]] || fail "invalid runtime table policy name"
  [[ "$privilege_list" =~ ^(SELECT|INSERT|UPDATE|DELETE)(,(SELECT|INSERT|UPDATE|DELETE))*$ ]] \
    || fail "invalid runtime privilege list for $table_name"
  [ -z "${seen_tables[$table_name]:-}" ] || fail "duplicate runtime table policy: $table_name"
  seen_tables[$table_name]=1
  table_privileges[$table_name]=$privilege_list
done < "$PRIVILEGE_POLICY"
[ "${#table_privileges[@]}" -gt 0 ] || fail "runtime table privilege policy is empty"

declare -A function_signatures=()
declare -A seen_functions=()
while IFS='=' read -r function_name function_signature || [ -n "$function_name" ]; do
  case "$function_name" in ''|'#'*) continue ;; esac
  [[ "$function_name" =~ ^[a-z][a-z0-9_]*$ ]] || fail "invalid runtime function policy name"
  [[ "$function_signature" =~ ^$|^(text|uuid)(,(text|uuid))*$ ]] \
    || fail "invalid runtime function signature for $function_name"
  [ -z "${seen_functions[$function_name]:-}" ] || fail "duplicate runtime function policy: $function_name"
  case "$function_name=$function_signature" in
    resume_ai_runtime_prune_competition_state=|\
    resume_ai_runtime_delete_expired_session_start=text|\
    resume_ai_runtime_reset_expired_session_transitions=text|\
    resume_ai_runtime_delete_pending_transition=text,text|\
    resume_ai_runtime_prune_model_gate=|\
    resume_ai_runtime_delete_model_waiter=uuid|\
    resume_ai_runtime_delete_model_lease=uuid) ;;
    *) fail "runtime function policy is outside the fixed reviewed RPC contract" ;;
  esac
  seen_functions[$function_name]=1
  function_signatures[$function_name]=$function_signature
done < "$FUNCTION_POLICY"
[ "${#function_signatures[@]}" -eq 7 ] || fail "runtime function policy must contain exactly seven reviewed RPCs"

declare -A legacy_delete_tables=(
  [ai_model_daily_usage]=1
  [competition_rate_limit_counters]=1
  [competition_session_starts]=1
  [competition_sessions]=1
  [competition_session_transitions]=1
  [competition_idempotency]=1
  [ai_model_call_leases]=1
  [ai_model_call_waiters]=1
)
for legacy_table in "${!legacy_delete_tables[@]}"; do
  [ -n "${table_privileges[$legacy_table]:-}" ] \
    || fail "legacy DELETE compatibility table is absent from the DML policy: $legacy_table"
  case ",${table_privileges[$legacy_table]}," in *,DELETE,*) fail "base table policy must never contain DELETE" ;; esac
done

TARGET_DELETE_MODE=strict
case "$MODE" in prepare|verify-compat|grant-legacy-delete) TARGET_DELETE_MODE=compat ;; esac

open_root_lock 9 postgres-role-hardening

psql_admin() {
  runuser -u postgres -- env -i PATH=/usr/bin:/bin PGHOST=/var/run/postgresql PGUSER=postgres \
    psql --dbname="$DATABASE_NAME" --no-psqlrc --set=ON_ERROR_STOP=1 "$@"
}

verify_local_peer() {
  local peer_contract
  peer_contract="$(psql_admin --tuples-only --no-align --field-separator=$'\t' --command="
    SELECT current_user, inet_server_addr() IS NULL, current_setting('data_directory'),
      (pg_control_system()).system_identifier::text;")"
  IFS=$'\t' read -r peer_user peer_is_local peer_data_dir peer_system_id <<< "$peer_contract"
  [ "$peer_user" = postgres ] && [ "$peer_is_local" = t ] \
    && [[ "$peer_data_dir" =~ ^/var/lib/postgresql/[0-9]+/main$ ]] \
    && [[ "$peer_system_id" =~ ^[0-9]{10,}$ ]] \
    || fail "privileged database connection is not the approved local peer cluster"
  unset peer_contract peer_user peer_is_local peer_data_dir peer_system_id
}
verify_local_peer

verify_authorization() {
  local delete_mode=${1:-strict}
  case "$delete_mode" in strict|compat) ;; *) fail "invalid DELETE authorization verification mode" ;; esac
  local expected_table_count=${#table_privileges[@]}
  local allowed_table_sql=""
  local table_name expected privilege table_gate unexpected privilege_gate
  local function_name function_signature function_gate allowed_function_sql=""
  for table_name in "${!table_privileges[@]}"; do
    if [ -n "$allowed_table_sql" ]; then allowed_table_sql+=","; fi
    allowed_table_sql+="'$table_name'"
  done
  for function_name in "${!function_signatures[@]}"; do
    function_signature=${function_signatures[$function_name]}
    [ -z "$allowed_function_sql" ] || allowed_function_sql+=" OR "
    allowed_function_sql+="(p.proname='$function_name' AND replace(pg_catalog.oidvectortypes(p.proargtypes), ' ', '')='$function_signature')"
  done
  role_gate="$(psql_admin --tuples-only --no-align --command="
    SELECT
      r.rolcanlogin AND NOT r.rolinherit
      AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
      AND NOT r.rolreplication AND NOT r.rolbypassrls
      AND d.datdba <> r.oid
      AND n.nspowner <> r.oid
      AND has_database_privilege('$RUNTIME_ROLE', '$DATABASE_NAME', 'CONNECT')
      AND NOT has_database_privilege('$RUNTIME_ROLE', '$DATABASE_NAME', 'CREATE')
      AND NOT has_database_privilege('$RUNTIME_ROLE', '$DATABASE_NAME', 'TEMP')
      AND has_schema_privilege('$RUNTIME_ROLE', 'public', 'USAGE')
      AND NOT has_schema_privilege('$RUNTIME_ROLE', 'public', 'CREATE')
      AND NOT EXISTS (
        SELECT 1 FROM pg_database other_database
        WHERE other_database.datallowconn AND other_database.datname <> '$DATABASE_NAME'
          AND has_database_privilege('$RUNTIME_ROLE', other_database.oid, 'CONNECT')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_database any_database
        WHERE has_database_privilege('$RUNTIME_ROLE', any_database.oid, 'CREATE')
           OR has_database_privilege('$RUNTIME_ROLE', any_database.oid, 'TEMP')
      )
      AND r.rolconfig IS NULL
      AND (
        SELECT coalesce(array_agg(setting ORDER BY setting), ARRAY[]::text[])
        FROM pg_db_role_setting settings
        CROSS JOIN LATERAL unnest(settings.setconfig) setting
        WHERE settings.setrole=r.oid AND settings.setdatabase=d.oid
      ) = ARRAY[
        'idle_in_transaction_session_timeout=15s',
        'lock_timeout=5s',
        'statement_timeout=10s'
      ]::text[]
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c WHERE c.relowner=r.oid
      )
      AND NOT EXISTS (SELECT 1 FROM pg_namespace owned_ns WHERE owned_ns.nspowner=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_proc owned_proc WHERE owned_proc.proowner=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_type owned_type WHERE owned_type.typowner=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_extension owned_extension WHERE owned_extension.extowner=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid)
      AND EXISTS (
        SELECT 1 FROM pg_roles owner_role
        WHERE owner_role.rolname='$OWNER_ROLE'
          AND NOT owner_role.rolcanlogin AND NOT owner_role.rolinherit
          AND NOT owner_role.rolsuper AND NOT owner_role.rolcreatedb
          AND NOT owner_role.rolcreaterole AND NOT owner_role.rolreplication
          AND NOT owner_role.rolbypassrls
          AND NOT EXISTS (
            SELECT 1 FROM pg_auth_members m
            WHERE m.member=owner_role.oid OR m.roleid=owner_role.oid
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
        WHERE ns.nspname='public' AND c.relname IN ($allowed_table_sql)
          AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname='$OWNER_ROLE')
      )
    FROM pg_roles r, pg_database d, pg_namespace n
    WHERE r.rolname='$RUNTIME_ROLE' AND d.datname='$DATABASE_NAME' AND n.nspname='public';")"
  [ "$role_gate" = t ] || fail "runtime database role retains ownership or DDL capability"
  scram_gate="$(psql_admin --tuples-only --no-align --command="
    SELECT current_setting('password_encryption')='scram-sha-256'
      AND EXISTS (
        SELECT 1 FROM pg_authid
        WHERE rolname='$RUNTIME_ROLE' AND left(rolpassword,15)='SCRAM-SHA-256$'
      )
      AND NOT EXISTS (SELECT 1 FROM pg_hba_file_rules WHERE error IS NOT NULL)
      AND EXISTS (
        SELECT 1 FROM pg_hba_file_rules
        WHERE type IN ('host','hostssl','hostnossl')
          AND ('all'=ANY(database) OR '$DATABASE_NAME'=ANY(database))
          AND ('all'=ANY(user_name) OR '$RUNTIME_ROLE'=ANY(user_name))
          AND auth_method='scram-sha-256'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_hba_file_rules
        WHERE type IN ('host','hostssl','hostnossl')
          AND ('all'=ANY(database) OR '$DATABASE_NAME'=ANY(database))
          AND ('all'=ANY(user_name) OR '$RUNTIME_ROLE'=ANY(user_name))
          AND auth_method NOT IN ('scram-sha-256','reject')
      );")"
  [ "$scram_gate" = t ] || fail "runtime password or loopback HBA is not an exact SCRAM contract"
  public_gate="$(psql_admin --tuples-only --no-align --command="
    SELECT
      NOT EXISTS (
        SELECT 1
        FROM pg_database d
        CROSS JOIN LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) acl
        WHERE d.datname='$DATABASE_NAME' AND acl.grantee=0
          AND acl.privilege_type IN ('CONNECT','CREATE','TEMPORARY')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_namespace n
        CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
        WHERE n.nspname='public' AND acl.grantee=0
          AND acl.privilege_type IN ('USAGE','CREATE')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(
          CASE WHEN c.relkind='S' THEN 'S'::\"char\" ELSE 'r'::\"char\" END,
          c.relowner
        ))) acl
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')
          AND acl.grantee=0
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        WHERE n.nspname='public' AND acl.grantee=0
      );")"
  [ "$public_gate" = t ] || fail "PUBLIC retains effective database or public-schema privileges"
  verified_tables=0
  for table_name in "${!table_privileges[@]}"; do
    expected=${table_privileges[$table_name]}
    IFS=',' read -r -a expected_privileges <<< "$expected"
    for privilege in "${expected_privileges[@]}"; do
      privilege_gate="$(psql_admin --tuples-only --no-align --command="
        SELECT to_regclass('public.$table_name') IS NOT NULL
          AND has_table_privilege('$RUNTIME_ROLE', 'public.$table_name', '$privilege');")"
      [ "$privilege_gate" = t ] || fail "runtime $privilege grant is missing for $table_name"
    done
    for privilege in SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER; do
      case ",$expected," in *",$privilege,"*) continue ;; esac
      if [ "$delete_mode" = compat ] && [ "$privilege" = DELETE ] \
        && [ -n "${legacy_delete_tables[$table_name]:-}" ]; then
        privilege_gate="$(psql_admin --tuples-only --no-align --command="
          SELECT has_table_privilege('$RUNTIME_ROLE', 'public.$table_name', 'DELETE');")"
        [ "$privilege_gate" = t ] || fail "legacy runtime DELETE is missing for $table_name"
        continue
      fi
      privilege_gate="$(psql_admin --tuples-only --no-align --command="
        SELECT NOT has_table_privilege('$RUNTIME_ROLE', 'public.$table_name', '$privilege');")"
      [ "$privilege_gate" = t ] || fail "runtime role has unapproved $privilege on $table_name"
    done
    verified_tables=$((verified_tables + 1))
  done
  [ "$verified_tables" -eq "$expected_table_count" ] || fail "runtime table policy verification was incomplete"
  unexpected="$(psql_admin --tuples-only --no-align --command="
    SELECT count(*)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
      AND c.relname NOT IN ($allowed_table_sql, 'resume_ai_schema_migrations')
      AND (
        has_table_privilege('$RUNTIME_ROLE', c.oid, 'SELECT')
        OR has_table_privilege('$RUNTIME_ROLE', c.oid, 'INSERT')
        OR has_table_privilege('$RUNTIME_ROLE', c.oid, 'UPDATE')
        OR has_table_privilege('$RUNTIME_ROLE', c.oid, 'DELETE')
        OR has_table_privilege('$RUNTIME_ROLE', c.oid, 'TRUNCATE')
        OR has_table_privilege('$RUNTIME_ROLE', c.oid, 'REFERENCES')
        OR has_table_privilege('$RUNTIME_ROLE', c.oid, 'TRIGGER')
      );")"
  [ "$unexpected" = 0 ] || fail "runtime role can access $unexpected non-allowlisted public relations"
  ledger_access="$(psql_admin --tuples-only --no-align --command="
    SELECT to_regclass('public.resume_ai_schema_migrations') IS NOT NULL
      AND NOT (
        has_table_privilege('$RUNTIME_ROLE', 'public.resume_ai_schema_migrations', 'SELECT')
        OR has_table_privilege('$RUNTIME_ROLE', 'public.resume_ai_schema_migrations', 'INSERT')
        OR has_table_privilege('$RUNTIME_ROLE', 'public.resume_ai_schema_migrations', 'UPDATE')
        OR has_table_privilege('$RUNTIME_ROLE', 'public.resume_ai_schema_migrations', 'DELETE')
        OR has_table_privilege('$RUNTIME_ROLE', 'public.resume_ai_schema_migrations', 'TRUNCATE')
        OR has_table_privilege('$RUNTIME_ROLE', 'public.resume_ai_schema_migrations', 'REFERENCES')
        OR has_table_privilege('$RUNTIME_ROLE', 'public.resume_ai_schema_migrations', 'TRIGGER')
      );")"
  [ "$ledger_access" = t ] || fail "runtime role can access the migration ledger"
  sequence_access="$(psql_admin --tuples-only --no-align --command="
    SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='S'
      AND (has_sequence_privilege('$RUNTIME_ROLE', c.oid, 'USAGE')
        OR has_sequence_privilege('$RUNTIME_ROLE', c.oid, 'SELECT')
        OR has_sequence_privilege('$RUNTIME_ROLE', c.oid, 'UPDATE'));")"
  [ "$sequence_access" = 0 ] || fail "runtime role retains public sequence privileges"
  delete_access="$(psql_admin --tuples-only --no-align --command="
    SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
      AND has_table_privilege('$RUNTIME_ROLE', c.oid, 'DELETE');")"
  if [ "$delete_mode" = strict ]; then
    [ "$delete_access" = 0 ] || fail "runtime role retains direct DELETE on $delete_access public relations"
  else
    [ "$delete_access" -eq "${#legacy_delete_tables[@]}" ] \
      || fail "legacy runtime DELETE differs from the exact eight-table compatibility set"
  fi
  function_access="$(psql_admin --tuples-only --no-align --command="
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND has_function_privilege('$RUNTIME_ROLE', p.oid, 'EXECUTE')
      AND NOT (
        (p.proname='gen_random_uuid' AND pg_catalog.oidvectortypes(p.proargtypes)='')
        OR $allowed_function_sql
      );")"
  [ "$function_access" = 0 ] || fail "runtime role can execute unapproved public-schema functions"
  for function_name in "${!function_signatures[@]}"; do
    function_signature=${function_signatures[$function_name]}
    if [ -n "$function_signature" ]; then strict_contract=t; else strict_contract=f; fi
    function_gate="$(psql_admin --tuples-only --no-align --command="
      SELECT count(*)=1
        AND bool_and(p.prosecdef AND p.provolatile='v' AND p.proparallel='u'
          AND p.proisstrict=$strict_contract
          AND l.lanname='plpgsql'
          AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
          AND owner_role.rolname='$OWNER_ROLE'
          AND NOT owner_role.rolcanlogin AND NOT owner_role.rolinherit
          AND NOT owner_role.rolsuper AND NOT owner_role.rolcreatedb
          AND NOT owner_role.rolcreaterole AND NOT owner_role.rolreplication
          AND NOT owner_role.rolbypassrls
          AND has_function_privilege('$RUNTIME_ROLE', p.oid, 'EXECUTE'))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_language l ON l.oid=p.prolang
      JOIN pg_roles owner_role ON owner_role.oid=p.proowner
      WHERE n.nspname='public' AND p.proname='$function_name'
        AND replace(pg_catalog.oidvectortypes(p.proargtypes), ' ', '')='$function_signature';")"
    [ "$function_gate" = t ] || fail "reviewed runtime function contract failed: $function_name($function_signature)"
  done
  uuid_function_gate="$(psql_admin --tuples-only --no-align --command="
    SELECT NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='gen_random_uuid'
        AND pg_get_function_identity_arguments(p.oid)=''
        AND NOT has_function_privilege('$RUNTIME_ROLE', p.oid, 'EXECUTE')
    );")"
  [ "$uuid_function_gate" = t ] || fail "runtime role cannot execute the approved UUID default"

  runtime_url="$($APP_ENV_READER get DATABASE_URL)"
  runuser -u resume-ai -- env -i PATH=/usr/bin:/bin PGDATABASE="$runtime_url" \
    psql --no-psqlrc --set=ON_ERROR_STOP=1 >/dev/null <<'SQL'
BEGIN;
INSERT INTO ai_consents (ip_hash, consent_version, purpose, provider, model)
VALUES ('deployment-permission-probe', 'probe', 'probe', 'probe', 'probe');
ROLLBACK;
SQL
  if runuser -u resume-ai -- env -i PATH=/usr/bin:/bin PGDATABASE="$runtime_url" \
    psql --no-psqlrc --set=ON_ERROR_STOP=1 \
    --command='CREATE TABLE runtime_role_must_not_create (id integer);' >/dev/null 2>&1; then
    psql_admin --command='DROP TABLE IF EXISTS runtime_role_must_not_create;' >/dev/null
    fail "runtime database role unexpectedly created a table"
  fi
  if [ "$delete_mode" = strict ]; then
    if runuser -u resume-ai -- env -i PATH=/usr/bin:/bin PGDATABASE="$runtime_url" \
      psql --no-psqlrc --set=ON_ERROR_STOP=1 \
      --command='DELETE FROM competition_idempotency WHERE false;' >/dev/null 2>&1; then
      fail "runtime database role unexpectedly has direct table DELETE"
    fi
  fi
  unset runtime_url
}

if [ "$MODE" = verify ] || [ "$MODE" = verify-compat ]; then
  verify_authorization "$TARGET_DELETE_MODE"
  printf '%s\n' "Runtime PostgreSQL $TARGET_DELETE_MODE authorization verification passed."
  exit 0
fi

RUNTIME_LOGIN_SUSPENDED=0
restore_runtime_login_on_exit() {
  local exit_status=$?
  trap - EXIT
  if [ "$RUNTIME_LOGIN_SUSPENDED" -eq 1 ]; then
    psql_admin --command="ALTER ROLE \"$RUNTIME_ROLE\" LOGIN;" >/dev/null 2>&1 || true
  fi
  exit "$exit_status"
}
trap restore_runtime_login_on_exit EXIT

suspend_runtime_connections() {
  psql_admin --command="ALTER ROLE \"$RUNTIME_ROLE\" NOLOGIN;" >/dev/null
  RUNTIME_LOGIN_SUSPENDED=1
  psql_admin --command="
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE usename='$RUNTIME_ROLE' AND pid <> pg_backend_pid();" >/dev/null
  remaining_sessions="$(psql_admin --tuples-only --no-align --command="
    SELECT count(*) FROM pg_stat_activity WHERE usename='$RUNTIME_ROLE';")"
  [ "$remaining_sessions" = 0 ] || fail "runtime sessions remained during ownership/ACL transition"
}

if [ "$MODE" = rollback ]; then
  BACKUP_DIR=$2
  case "$BACKUP_DIR" in /var/backups/resume-ai/postgresql/role-hardening/20??????T??????Z) ;; *) fail "unsafe role-hardening backup path" ;; esac
  [ -f "$BACKUP_DIR/rollback.sql" ] && [ ! -L "$BACKUP_DIR/rollback.sql" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$BACKUP_DIR/rollback.sql")" = root:root:600:1 ] \
    || fail "protected authorization rollback is missing"
  [ -f "$BACKUP_DIR/SHA256SUMS" ] && [ ! -L "$BACKUP_DIR/SHA256SUMS" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$BACKUP_DIR/SHA256SUMS")" = root:root:600:1 ] \
    || fail "protected authorization checksums are missing"
  (cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS >/dev/null)
  suspend_runtime_connections
  psql_admin --single-transaction --file="$BACKUP_DIR/rollback.sql" >/dev/null
  RUNTIME_LOGIN_SUSPENDED=0
  trap - EXIT
  printf '%s\n' "Restored pre-hardening PostgreSQL ownership from $BACKUP_DIR."
  exit 0
fi

for table_name in "${!table_privileges[@]}"; do
  exists="$(psql_admin --tuples-only --no-align --command="SELECT to_regclass('public.$table_name') IS NOT NULL;")"
  [ "$exists" = t ] || fail "required runtime table does not exist: $table_name"
done
for function_name in "${!function_signatures[@]}"; do
  function_signature=${function_signatures[$function_name]}
  function_exists="$(psql_admin --tuples-only --no-align --command="
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='$function_name'
      AND replace(pg_catalog.oidvectortypes(p.proargtypes), ' ', '')='$function_signature';")"
  [ "$function_exists" = 1 ] || fail "required reviewed runtime function is missing or ambiguous: $function_name($function_signature)"
done

role_memberships="$(psql_admin --tuples-only --no-align --command="
  SELECT count(*) FROM pg_auth_members m
  WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='$RUNTIME_ROLE')
     OR m.roleid=(SELECT oid FROM pg_roles WHERE rolname='$RUNTIME_ROLE');")"
[ "$role_memberships" = 0 ] || fail "runtime role memberships require manual review before hardening"
unexpected_databases="$(psql_admin --tuples-only --no-align --command="
  SELECT count(*) FROM pg_database
  WHERE datallowconn AND datname NOT IN ('$DATABASE_NAME','postgres','template1');")"
[ "$unexpected_databases" = 0 ] \
  || fail "unexpected connectable databases require a separately reviewed cluster ACL plan"

owner_role_exists="$(psql_admin --tuples-only --no-align --command="SELECT count(*) FROM pg_roles WHERE rolname='$OWNER_ROLE';")"
owned_object_count="$(psql_admin --tuples-only --no-align --command="
  SELECT
    (SELECT count(*) FROM pg_database WHERE datname='$DATABASE_NAME'
      AND datdba=(SELECT oid FROM pg_roles WHERE rolname='$RUNTIME_ROLE'))
    + (SELECT count(*) FROM pg_namespace
      WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname='$RUNTIME_ROLE'))
    + (SELECT count(*) FROM pg_class
      WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='$RUNTIME_ROLE'))
    + (SELECT count(*) FROM pg_proc
      WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname='$RUNTIME_ROLE'))
    + (SELECT count(*) FROM pg_type
      WHERE typowner=(SELECT oid FROM pg_roles WHERE rolname='$RUNTIME_ROLE'))
    + (SELECT count(*) FROM pg_extension
      WHERE extowner=(SELECT oid FROM pg_roles WHERE rolname='$RUNTIME_ROLE')); ")"
SPLIT_OWNER_ROLE=0
CREATE_OWNER_ROLE=0
if [ "$owned_object_count" -gt 0 ]; then
  [ "$owner_role_exists" = 0 ] \
    || fail "runtime role still owns objects while its reserved owner role already exists"
  SPLIT_OWNER_ROLE=1
elif [ "$owner_role_exists" = 0 ]; then
  CREATE_OWNER_ROLE=1
fi

BACKUP_ROOT=/var/backups/resume-ai/postgresql/role-hardening
BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
[ ! -e "$BACKUP_DIR" ] || fail "role-hardening backup directory already exists"
install -d -o root -g root -m 0700 "$BACKUP_ROOT" "$BACKUP_DIR"
runuser -u postgres -- env -i PATH=/usr/bin:/bin PGHOST=/var/run/postgresql PGUSER=postgres \
  pg_dumpall --roles-only > "$BACKUP_DIR/roles-before.sql"
chmod 0600 "$BACKUP_DIR/roles-before.sql"

database_owner="$(psql_admin --tuples-only --no-align --command="SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='$DATABASE_NAME';")"
schema_owner="$(psql_admin --tuples-only --no-align --command="SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public';")"
[[ "$database_owner" =~ ^[a-z_][a-z0-9_-]{0,62}$ ]] || fail "unexpected database owner"
[[ "$schema_owner" =~ ^[a-z_][a-z0-9_-]{0,62}$ ]] || fail "unexpected public schema owner"

rollback_sql="$BACKUP_DIR/rollback.sql"
cat > "$rollback_sql" <<EOF
SET LOCAL lock_timeout TO '5s';
SET LOCAL statement_timeout TO '60s';
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "$RUNTIME_ROLE";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "$RUNTIME_ROLE";
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM "$RUNTIME_ROLE";
REVOKE ALL PRIVILEGES ON SCHEMA public FROM "$RUNTIME_ROLE";
REVOKE ALL PRIVILEGES ON DATABASE "$DATABASE_NAME" FROM "$RUNTIME_ROLE";
ALTER ROLE "$RUNTIME_ROLE" RESET ALL;
ALTER ROLE "$RUNTIME_ROLE" IN DATABASE "$DATABASE_NAME" RESET ALL;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE "$DATABASE_NAME" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE postgres FROM PUBLIC, "$RUNTIME_ROLE";
REVOKE ALL PRIVILEGES ON DATABASE template1 FROM PUBLIC, "$RUNTIME_ROLE";
EOF

# Restore the effective PUBLIC ACLs which the hardening intentionally removes.
# The runtime OID is deliberately preserved during the initial split, so both
# PUBLIC and direct runtime ACLs can be restored exactly.
acl_grantees="0,(SELECT oid FROM pg_roles WHERE rolname='$RUNTIME_ROLE')"
psql_admin --tuples-only --no-align --command="
  SELECT format('GRANT %s ON DATABASE %I TO %s%s;', acl.privilege_type, d.datname,
    CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE quote_ident('$RUNTIME_ROLE') END,
    CASE WHEN acl.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
  FROM pg_database d
  CROSS JOIN LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) acl
  WHERE d.datname='$DATABASE_NAME' AND acl.grantee IN ($acl_grantees)
  ORDER BY acl.grantee, acl.privilege_type;" >> "$rollback_sql"
for cluster_database in postgres template1; do
  psql_admin --tuples-only --no-align --command="
    SELECT format('GRANT %s ON DATABASE %I TO %s%s;', acl.privilege_type, d.datname,
      CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE quote_ident('$RUNTIME_ROLE') END,
      CASE WHEN acl.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
    FROM pg_database d
    CROSS JOIN LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) acl
    WHERE d.datname='$cluster_database' AND acl.grantee IN ($acl_grantees)
    ORDER BY acl.grantee, acl.privilege_type;" >> "$rollback_sql"
done
psql_admin --tuples-only --no-align --command="
  SELECT format('GRANT %s ON SCHEMA %I TO %s%s;', acl.privilege_type, n.nspname,
    CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE quote_ident('$RUNTIME_ROLE') END,
    CASE WHEN acl.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
  FROM pg_namespace n
  CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
  WHERE n.nspname='public' AND acl.grantee IN ($acl_grantees)
  ORDER BY acl.grantee, acl.privilege_type;" >> "$rollback_sql"
psql_admin --tuples-only --no-align --command="
  SELECT format('GRANT %s ON %s %I.%I TO %s%s;', acl.privilege_type,
    CASE c.relkind WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
    n.nspname, c.relname,
    CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE quote_ident('$RUNTIME_ROLE') END,
    CASE WHEN acl.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(
    CASE WHEN c.relkind='S' THEN 'S'::\"char\" ELSE 'r'::\"char\" END,
    c.relowner
  ))) acl
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')
    AND acl.grantee IN ($acl_grantees)
  ORDER BY c.relkind, c.relname, acl.grantee, acl.privilege_type;" >> "$rollback_sql"
psql_admin --tuples-only --no-align --command="
  SELECT format('GRANT %s ON FUNCTION %I.%I(%s) TO %s%s;', acl.privilege_type,
    n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
    CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE quote_ident('$RUNTIME_ROLE') END,
    CASE WHEN acl.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  WHERE n.nspname='public' AND acl.grantee IN ($acl_grantees)
  ORDER BY p.proname, pg_get_function_identity_arguments(p.oid), acl.grantee;" >> "$rollback_sql"
psql_admin --tuples-only --no-align --command="
  SELECT format('ALTER ROLE %I SET %I TO %L;', '$RUNTIME_ROLE',
    split_part(setting, '=', 1), substr(setting, strpos(setting, '=') + 1))
  FROM pg_roles r
  CROSS JOIN LATERAL unnest(coalesce(r.rolconfig, ARRAY[]::text[])) setting
  WHERE r.rolname='$RUNTIME_ROLE' ORDER BY setting;" >> "$rollback_sql"
psql_admin --tuples-only --no-align --command="
  SELECT format('ALTER ROLE %I IN DATABASE %I SET %I TO %L;', '$RUNTIME_ROLE', '$DATABASE_NAME',
    split_part(setting, '=', 1), substr(setting, strpos(setting, '=') + 1))
  FROM pg_db_role_setting settings
  JOIN pg_roles r ON r.oid=settings.setrole
  JOIN pg_database d ON d.oid=settings.setdatabase
  CROSS JOIN LATERAL unnest(coalesce(settings.setconfig, ARRAY[]::text[])) setting
  WHERE r.rolname='$RUNTIME_ROLE' AND d.datname='$DATABASE_NAME' ORDER BY setting;" >> "$rollback_sql"

# Restore object owners as well as ACLs. During the initial role split every
# pre-existing runtime-owned object is transferred back first. Explicit owner
# records then correct reviewed tables/functions which may originally have
# belonged to the root migration role.
if [ "$SPLIT_OWNER_ROLE" -eq 1 ]; then
  printf 'REASSIGN OWNED BY "%s" TO "%s";\n' "$OWNER_ROLE" "$RUNTIME_ROLE" >> "$rollback_sql"
fi
for table_name in "${!table_privileges[@]}"; do
  table_owner="$(psql_admin --tuples-only --no-align --command="
    SELECT pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='$table_name' AND c.relkind IN ('r','p');")"
  [[ "$table_owner" =~ ^[a-z_][a-z0-9_-]{0,62}$ ]] || fail "could not capture owner for $table_name"
  printf 'ALTER TABLE public.%s OWNER TO "%s";\n' "$table_name" "$table_owner" >> "$rollback_sql"
done
for function_name in "${!function_signatures[@]}"; do
  function_signature=${function_signatures[$function_name]}
  function_owner="$(psql_admin --tuples-only --no-align --command="
    SELECT pg_get_userbyid(p.proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='$function_name'
      AND replace(pg_catalog.oidvectortypes(p.proargtypes), ' ', '')='$function_signature';")"
  [[ "$function_owner" =~ ^[a-z_][a-z0-9_-]{0,62}$ ]] || fail "could not capture owner for $function_name"
  printf 'ALTER FUNCTION public.%s(%s) OWNER TO "%s";\n' \
    "$function_name" "$function_signature" "$function_owner" >> "$rollback_sql"
done
if [ "$SPLIT_OWNER_ROLE" -eq 1 ] || [ "$CREATE_OWNER_ROLE" -eq 1 ]; then
  printf 'DROP ROLE "%s";\n' "$OWNER_ROLE" >> "$rollback_sql"
fi

role_restore="$(psql_admin --tuples-only --no-align --command="
  SELECT format(
    'ALTER ROLE %I %s %s %s %s %s %s %s CONNECTION LIMIT %s;',
    rolname,
    CASE WHEN rolsuper THEN 'SUPERUSER' ELSE 'NOSUPERUSER' END,
    CASE WHEN rolcreatedb THEN 'CREATEDB' ELSE 'NOCREATEDB' END,
    CASE WHEN rolcreaterole THEN 'CREATEROLE' ELSE 'NOCREATEROLE' END,
    CASE WHEN rolinherit THEN 'INHERIT' ELSE 'NOINHERIT' END,
    CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END,
    CASE WHEN rolreplication THEN 'REPLICATION' ELSE 'NOREPLICATION' END,
    CASE WHEN rolbypassrls THEN 'BYPASSRLS' ELSE 'NOBYPASSRLS' END,
    rolconnlimit)
  FROM pg_roles WHERE rolname='$RUNTIME_ROLE';")"
[ -n "$role_restore" ] || fail "could not capture runtime role attributes"
printf '%s\n' "$role_restore" >> "$rollback_sql"
chmod 0600 "$rollback_sql"

apply_sql="$BACKUP_DIR/apply.sql"
if [ "$SPLIT_OWNER_ROLE" -eq 1 ]; then
  cat > "$apply_sql" <<EOF
SET LOCAL lock_timeout TO '5s';
SET LOCAL statement_timeout TO '60s';
CREATE ROLE "$OWNER_ROLE" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
REASSIGN OWNED BY "$RUNTIME_ROLE" TO "$OWNER_ROLE";
ALTER ROLE "$OWNER_ROLE" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE "$RUNTIME_ROLE" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
EOF
  if [ "$database_owner" = "$RUNTIME_ROLE" ]; then
    printf 'ALTER DATABASE "%s" OWNER TO "%s";\n' "$DATABASE_NAME" "$OWNER_ROLE" >> "$apply_sql"
  fi
  if [ "$schema_owner" = "$RUNTIME_ROLE" ]; then
    printf 'ALTER SCHEMA public OWNER TO "%s";\n' "$OWNER_ROLE" >> "$apply_sql"
  fi
elif [ "$CREATE_OWNER_ROLE" -eq 1 ]; then
  cat > "$apply_sql" <<EOF
SET LOCAL lock_timeout TO '5s';
SET LOCAL statement_timeout TO '60s';
CREATE ROLE "$OWNER_ROLE" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE "$RUNTIME_ROLE" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
EOF
else
  cat > "$apply_sql" <<EOF
SET LOCAL lock_timeout TO '5s';
SET LOCAL statement_timeout TO '60s';
ALTER ROLE "$OWNER_ROLE" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE "$RUNTIME_ROLE" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
EOF
fi
cat >> "$apply_sql" <<EOF
REVOKE ALL PRIVILEGES ON DATABASE "$DATABASE_NAME" FROM PUBLIC, "$RUNTIME_ROLE";
GRANT CONNECT ON DATABASE "$DATABASE_NAME" TO "$RUNTIME_ROLE";
REVOKE ALL PRIVILEGES ON DATABASE postgres FROM PUBLIC, "$RUNTIME_ROLE";
REVOKE ALL PRIVILEGES ON DATABASE template1 FROM PUBLIC, "$RUNTIME_ROLE";
ALTER ROLE "$RUNTIME_ROLE" RESET ALL;
ALTER ROLE "$RUNTIME_ROLE" IN DATABASE "$DATABASE_NAME" RESET ALL;
ALTER ROLE "$RUNTIME_ROLE" IN DATABASE "$DATABASE_NAME" SET statement_timeout TO '10s';
ALTER ROLE "$RUNTIME_ROLE" IN DATABASE "$DATABASE_NAME" SET lock_timeout TO '5s';
ALTER ROLE "$RUNTIME_ROLE" IN DATABASE "$DATABASE_NAME" SET idle_in_transaction_session_timeout TO '15s';
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC, "$RUNTIME_ROLE";
GRANT USAGE ON SCHEMA public TO "$RUNTIME_ROLE";
EOF
cat >> "$apply_sql" <<EOF
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, "$RUNTIME_ROLE";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, "$RUNTIME_ROLE";
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, "$RUNTIME_ROLE";
REVOKE ALL PRIVILEGES ON TABLE resume_ai_schema_migrations FROM "$RUNTIME_ROLE";
EOF
for table_name in "${!table_privileges[@]}"; do
  printf 'ALTER TABLE public.%s OWNER TO "%s";\n' "$table_name" "$OWNER_ROLE" >> "$apply_sql"
  printf 'GRANT %s ON TABLE public.%s TO "%s";\n' \
    "${table_privileges[$table_name]}" "$table_name" "$RUNTIME_ROLE" >> "$apply_sql"
  if [ "$TARGET_DELETE_MODE" = compat ] && [ -n "${legacy_delete_tables[$table_name]:-}" ]; then
    printf 'GRANT DELETE ON TABLE public.%s TO "%s";\n' \
      "$table_name" "$RUNTIME_ROLE" >> "$apply_sql"
  fi
done
for function_name in "${!function_signatures[@]}"; do
  function_signature=${function_signatures[$function_name]}
  printf 'ALTER FUNCTION public.%s(%s) OWNER TO "%s";\n' \
    "$function_name" "$function_signature" "$OWNER_ROLE" >> "$apply_sql"
  printf 'REVOKE ALL ON FUNCTION public.%s(%s) FROM PUBLIC, "%s";\n' \
    "$function_name" "$function_signature" "$RUNTIME_ROLE" >> "$apply_sql"
  printf 'GRANT EXECUTE ON FUNCTION public.%s(%s) TO "%s";\n' \
    "$function_name" "$function_signature" "$RUNTIME_ROLE" >> "$apply_sql"
done
psql_admin --tuples-only --no-align --command="
  SELECT format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO %I;',
    n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), '$RUNTIME_ROLE')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='gen_random_uuid'
    AND pg_get_function_identity_arguments(p.oid)='';" >> "$apply_sql"
chmod 0600 "$apply_sql"
(cd "$BACKUP_DIR" && sha256sum roles-before.sql rollback.sql apply.sql > SHA256SUMS && chmod 0600 SHA256SUMS)
sync -f "$BACKUP_DIR/roles-before.sql"
sync -f "$rollback_sql"
sync -f "$apply_sql"
sync -f "$BACKUP_DIR/SHA256SUMS"
sync -f "$BACKUP_DIR"
suspend_runtime_connections
psql_admin --single-transaction --file="$apply_sql" >/dev/null
RUNTIME_LOGIN_SUSPENDED=0
verify_authorization "$TARGET_DELETE_MODE"
cat > "$BACKUP_DIR/RESULT" <<EOF
status=completed
delete_mode=$TARGET_DELETE_MODE
legacy_target_release=$LEGACY_TARGET_RELEASE
EOF
chmod 0600 "$BACKUP_DIR/RESULT"
sync -f "$BACKUP_DIR/RESULT"
sync -f "$BACKUP_DIR"
trap - EXIT
printf '%s\n' "Runtime PostgreSQL authorization is $TARGET_DELETE_MODE; protected rollback: $BACKUP_DIR"
