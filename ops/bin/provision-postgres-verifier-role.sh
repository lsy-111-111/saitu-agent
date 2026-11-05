#!/usr/bin/env bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 1 ] || fail "usage: provision-postgres-verifier-role.sh reconcile|verify"
MODE=$1
case "$MODE" in reconcile|verify) ;; *) fail "unsupported verifier-role mode" ;; esac
if [ "$MODE" = reconcile ]; then
  [ "${ACK_POSTGRES_VERIFIER_ROLE:-}" = YES ] \
    || fail "set ACK_POSTGRES_VERIFIER_ROLE=YES after the database backup is verified"
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[ "$SCRIPT_DIR" = /usr/local/lib/resume-ai ] \
  || fail "database verifier role control must run from the root-installed generation"
. "$SCRIPT_DIR/open-root-lock.sh"
open_root_lock 6 postgres-role-hardening

CONFIG_READER="$SCRIPT_DIR/read-backup-config.sh"
CONFIG_FILE=/etc/resume-ai/backup.env
for trusted_file in "$SCRIPT_DIR/provision-postgres-verifier-role.sh" \
  "$SCRIPT_DIR/open-root-lock.sh" "$CONFIG_READER"; do
  [ -f "$trusted_file" ] && [ ! -L "$trusted_file" ] \
    && [ "$(stat -c '%U:%G:%a:%h' "$trusted_file")" = root:root:755:1 ] \
    || fail "trusted verifier-role control is missing or unsafe: $trusted_file"
done
"$CONFIG_READER" validate "$CONFIG_FILE"
DATABASE_NAME="$("$CONFIG_READER" get DB_NAME "$CONFIG_FILE")"
[[ "$DATABASE_NAME" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "invalid backup database name"

psql_admin() {
  local database=$1
  shift
  runuser -u postgres -- env -i PATH=/usr/bin:/bin PGHOST=/var/run/postgresql \
    PGUSER=postgres psql --dbname="$database" --no-psqlrc --set=ON_ERROR_STOP=1 "$@"
}

if [ "$MODE" = reconcile ]; then
  psql_admin postgres --set=database_name="$DATABASE_NAME" <<'SQL'
SELECT NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'resume-ai-dbverify'
) AS create_verifier_role \gset
\if :create_verifier_role
CREATE ROLE "resume-ai-dbverify";
\endif
ALTER ROLE "resume-ai-dbverify" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD NULL VALID UNTIL 'infinity';
ALTER ROLE "resume-ai-dbverify" RESET ALL;
SELECT pg_catalog.format('REVOKE %I FROM %I', parent.rolname, 'resume-ai-dbverify')
FROM pg_catalog.pg_auth_members membership
JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
JOIN pg_catalog.pg_roles member ON member.oid = membership.member
WHERE member.rolname = 'resume-ai-dbverify' \gexec
SELECT pg_catalog.format('REVOKE %I FROM %I', 'resume-ai-dbverify', member.rolname)
FROM pg_catalog.pg_auth_members membership
JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
JOIN pg_catalog.pg_roles member ON member.oid = membership.member
WHERE parent.rolname = 'resume-ai-dbverify' \gexec
REVOKE ALL PRIVILEGES ON DATABASE :"database_name" FROM "resume-ai-dbverify";
GRANT CONNECT ON DATABASE :"database_name" TO "resume-ai-dbverify";
ALTER ROLE "resume-ai-dbverify" IN DATABASE :"database_name"
  SET default_transaction_read_only = on;
ALTER ROLE "resume-ai-dbverify" IN DATABASE :"database_name"
  SET default_transaction_isolation = 'repeatable read';
ALTER ROLE "resume-ai-dbverify" IN DATABASE :"database_name"
  SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE "resume-ai-dbverify" IN DATABASE :"database_name"
  SET lock_timeout = '5s';
ALTER ROLE "resume-ai-dbverify" IN DATABASE :"database_name"
  SET search_path = 'pg_catalog';
ALTER ROLE "resume-ai-dbverify" IN DATABASE :"database_name"
  SET statement_timeout = '30s';
SQL
  psql_admin "$DATABASE_NAME" <<'SQL'
REVOKE ALL PRIVILEGES ON SCHEMA public FROM "resume-ai-dbverify";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "resume-ai-dbverify";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "resume-ai-dbverify";
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM "resume-ai-dbverify";
SQL
fi

role_gate="$(psql_admin "$DATABASE_NAME" --tuples-only --no-align --command="
  SELECT r.rolcanlogin AND NOT r.rolinherit
    AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
    AND NOT r.rolreplication AND NOT r.rolbypassrls
    AND r.rolconnlimit = 1 AND r.rolpassword IS NULL
    AND d.datdba <> r.oid
    AND has_database_privilege(r.oid, d.oid, 'CONNECT')
    AND NOT has_database_privilege(r.oid, d.oid, 'CREATE')
    AND NOT has_database_privilege(r.oid, d.oid, 'TEMP')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members membership
      WHERE membership.member = r.oid OR membership.roleid = r.oid
    )
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class object WHERE object.relowner = r.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc object WHERE object.proowner = r.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace object WHERE object.nspowner = r.oid)
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace namespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(
        namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner)
      )) privilege
      WHERE namespace.nspname = 'public' AND privilege.grantee = r.oid
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(
        relation.relacl,
        pg_catalog.acldefault(CASE WHEN relation.relkind = 'S' THEN 'S'::\"char\" ELSE 'r'::\"char\" END, relation.relowner)
      )) privilege
      WHERE namespace.nspname = 'public' AND privilege.grantee = r.oid
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(
        procedure.proacl, pg_catalog.acldefault('f', procedure.proowner)
      )) privilege
      WHERE namespace.nspname = 'public' AND privilege.grantee = r.oid
    )
    AND (
      SELECT coalesce(array_agg(setting ORDER BY setting), ARRAY[]::text[])
      FROM pg_catalog.pg_db_role_setting settings
      CROSS JOIN LATERAL unnest(settings.setconfig) setting
      WHERE settings.setrole = r.oid AND settings.setdatabase = d.oid
    ) = ARRAY[
      'default_transaction_isolation=repeatable read',
      'default_transaction_read_only=on',
      'idle_in_transaction_session_timeout=15s',
      'lock_timeout=5s',
      'search_path=pg_catalog',
      'statement_timeout=30s'
    ]::text[]
  FROM pg_catalog.pg_roles r, pg_catalog.pg_database d
  WHERE r.rolname = 'resume-ai-dbverify' AND d.datname = '$DATABASE_NAME';")"
[ "$role_gate" = t ] || fail "read-only verifier role is not an exact least-privilege contract"

peer_gate="$(runuser -u resume-ai-dbverify -- env -i PATH=/usr/bin:/bin \
  PGHOST=/var/run/postgresql PGUSER=resume-ai-dbverify \
  psql --dbname="$DATABASE_NAME" --no-psqlrc --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --command="SELECT session_user = 'resume-ai-dbverify'
    AND current_user = 'resume-ai-dbverify'
    AND current_setting('default_transaction_read_only') = 'on'
    AND inet_server_addr() IS NULL;")"
[ "$peer_gate" = t ] || fail "dedicated verifier peer session is not local and read-only"
printf '%s\n' "PostgreSQL read-only verifier role contract passed for $DATABASE_NAME."
