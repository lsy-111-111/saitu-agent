#!/usr/bin/env bash
set -Eeuo pipefail

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
PG_BINDIR=${PG_BINDIR:-/Volumes/Postgres-2.9.5-14/Postgres.app/Contents/Versions/14/bin}
for binary in initdb pg_ctl psql createdb dropdb pg_dump pg_restore; do
  [ -x "$PG_BINDIR/$binary" ] || fail "missing PostgreSQL regression binary: $PG_BINDIR/$binary"
done

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/resume-ai-pg-ops.XXXXXX")"
PG_DATA="$TEST_ROOT/data"
PG_SOCKET="$TEST_ROOT/socket"
mkdir -m 0700 "$PG_SOCKET"
cleanup() {
  local status=$?
  trap - EXIT
  "$PG_BINDIR/pg_ctl" -D "$PG_DATA" -m immediate stop >/dev/null 2>&1 || true
  find "$TEST_ROOT" -depth -delete >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

env -i PATH="$PG_BINDIR:/usr/bin:/bin" "$PG_BINDIR/initdb" -D "$PG_DATA" \
  --encoding=UTF8 --locale=C --auth=trust >/dev/null
env -i PATH="$PG_BINDIR:/usr/bin:/bin" "$PG_BINDIR/pg_ctl" -D "$PG_DATA" \
  -o "-c listen_addresses='' -k '$PG_SOCKET' -p 55439" -w start >/dev/null
export PGHOST="$PG_SOCKET" PGPORT=55439 PGDATABASE=postgres
PSQL=("$PG_BINDIR/psql" --no-psqlrc --set=ON_ERROR_STOP=1 --quiet)
"${PSQL[@]}" <<'SQL'
CREATE DATABASE resume_ai_ops_test;
CREATE DATABASE forbidden_ops_test;
CREATE ROLE resume_ai_security_maintenance NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE resume_ai_ops_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE resume_ai_ops_runtime LOGIN PASSWORD 'deployment-test-db-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
REVOKE ALL ON DATABASE forbidden_ops_test FROM PUBLIC, resume_ai_ops_runtime;
REVOKE CREATE,TEMPORARY ON DATABASE resume_ai_ops_test FROM PUBLIC;
GRANT CONNECT ON DATABASE resume_ai_ops_test TO resume_ai_ops_runtime;
SQL
PGDATABASE=resume_ai_ops_test "${PSQL[@]}" <<'SQL'
CREATE TABLE ai_consents (created_at timestamptz NOT NULL, payload text);
CREATE TABLE ai_model_call_leases (expires_at timestamptz NOT NULL, payload text);
CREATE TABLE ai_model_call_waiters (expires_at timestamptz NOT NULL, payload text);
CREATE TABLE competition_idempotency (expires_at timestamptz NOT NULL, payload text);
CREATE TABLE competition_rate_limit_counters (reset_at timestamptz NOT NULL, payload text);
CREATE TABLE competition_session_starts (expires_at timestamptz NOT NULL, payload text);
CREATE TABLE competition_session_transitions (expires_at timestamptz NOT NULL, payload text);
CREATE TABLE competition_sessions (expires_at timestamptz NOT NULL, payload text);
GRANT USAGE ON SCHEMA public TO resume_ai_security_maintenance;
GRANT SELECT,DELETE ON ALL TABLES IN SCHEMA public TO resume_ai_security_maintenance;
GRANT UPDATE (created_at) ON ai_consents TO resume_ai_security_maintenance;
GRANT UPDATE (expires_at) ON ai_model_call_leases,ai_model_call_waiters,competition_idempotency,
  competition_session_starts,competition_session_transitions,competition_sessions TO resume_ai_security_maintenance;
GRANT UPDATE (reset_at) ON competition_rate_limit_counters TO resume_ai_security_maintenance;
INSERT INTO ai_consents VALUES (now()-interval '181 days','expired'),(now(),'live');
INSERT INTO ai_model_call_leases VALUES (now()-interval '1 second','expired'),(now()+interval '1 hour','live');
INSERT INTO ai_model_call_waiters VALUES (now()-interval '1 second','expired'),(now()+interval '1 hour','live');
INSERT INTO competition_idempotency VALUES (now()-interval '1 second','expired'),(now()+interval '1 hour','live');
INSERT INTO competition_idempotency
SELECT now()-interval '1 second','expired-batch' FROM generate_series(1,1200);
INSERT INTO competition_rate_limit_counters VALUES (now()-interval '1 second','expired'),(now()+interval '1 hour','live');
INSERT INTO competition_session_starts VALUES (now()-interval '1 second','expired'),(now()+interval '1 hour','live');
INSERT INTO competition_session_transitions VALUES (now()-interval '1 second','expired'),(now()+interval '1 hour','live');
INSERT INTO competition_sessions VALUES (now()-interval '1 second','expired'),(now()+interval '1 hour','live');
SQL
# Exercise the real new-table definitions, rather than stand-in payload tables.
PGDATABASE=resume_ai_ops_test "${PSQL[@]}" --file="$REPO_ROOT/db/migrations/20261105_decision_states.sql"
PGDATABASE=resume_ai_ops_test "${PSQL[@]}" --file="$REPO_ROOT/db/migrations/20261105_ai_spend_ledger.sql"
PGDATABASE=resume_ai_ops_test "${PSQL[@]}" --file="$REPO_ROOT/db/migrations/20261105_spend_authority.sql"
PGDATABASE=resume_ai_ops_test "${PSQL[@]}" --file="$REPO_ROOT/db/migrations/20261109_decision_runs.sql"
PGDATABASE=resume_ai_ops_test "${PSQL[@]}" --file="$REPO_ROOT/db/migrations/20261109_decision_runs_chat_requests.sql"
PGDATABASE=resume_ai_ops_test "${PSQL[@]}" <<'SQL'
GRANT SELECT,DELETE ON competition_decision_states TO resume_ai_security_maintenance;
GRANT UPDATE (expires_at) ON competition_decision_states TO resume_ai_security_maintenance;
GRANT SELECT,DELETE ON competition_decision_runs,competition_decision_calls,competition_decision_chat_requests TO resume_ai_security_maintenance;
GRANT UPDATE (expires_at) ON competition_decision_runs TO resume_ai_security_maintenance;
GRANT UPDATE (run_id) ON competition_decision_calls,competition_decision_chat_requests TO resume_ai_security_maintenance;
INSERT INTO competition_decision_states(state_key,ciphertext,iv,tag,expires_at)
VALUES (repeat('a',64),decode('010203','hex'),decode(repeat('00',12),'hex'),decode(repeat('00',16),'hex'),now()-interval '1 second'),
       (repeat('b',64),decode('040506','hex'),decode(repeat('00',12),'hex'),decode(repeat('00',16),'hex'),now()+interval '1 hour');
INSERT INTO ai_spend_budgets(run_id,hard_limit_micros,created_at) VALUES ('retention-test',1000000,now()-interval '181 days');
INSERT INTO ai_spend_authority(singleton,run_id) VALUES(true,'retention-test');
INSERT INTO ai_spend_ledger(id,run_id,model,effort,operation,price_version,reserved_micros,charged_micros,state,created_at,settled_at)
VALUES ('00000000-0000-4000-8000-000000000001','retention-test','deepseek-flash','max','test-only','fixture',100,100,'conservative',now()-interval '181 days',now()-interval '181 days');
SQL
cleanup_passes=0
while :; do
  cleanup_output="$(PGDATABASE=resume_ai_ops_test "${PSQL[@]}" --file="$REPO_ROOT/ops/postgresql/cleanup-security-state.sql")"
  cleanup_marker="$(printf '%s\n' "$cleanup_output" | grep -E '^CLEANUP_(COMPLETE|REMAINING)$')"
  cleanup_passes=$((cleanup_passes + 1))
  case "$cleanup_marker" in CLEANUP_COMPLETE) break ;; CLEANUP_REMAINING) ;; *) fail "cleanup batch returned an invalid marker" ;; esac
  [ "$cleanup_passes" -le 10 ] || fail "cleanup backlog did not converge"
done
[ "$cleanup_passes" -ge 3 ] || fail "cleanup regression did not exercise multiple committed batches"
cleanup_gate="$(PGDATABASE=resume_ai_ops_test "${PSQL[@]}" --tuples-only --no-align --command="
  SELECT (SELECT count(*) FROM ai_consents)=1
    AND (SELECT count(*) FROM ai_model_call_leases)=1
    AND (SELECT count(*) FROM ai_model_call_waiters)=1
    AND (SELECT count(*) FROM competition_idempotency)=1
    AND (SELECT count(*) FROM competition_rate_limit_counters)=1
    AND (SELECT count(*) FROM competition_session_starts)=1
    AND (SELECT count(*) FROM competition_session_transitions)=1
    AND (SELECT count(*) FROM competition_sessions)=1
    AND (SELECT count(*) FROM competition_decision_states)=1
    AND (SELECT state_key FROM competition_decision_states)=repeat('b',64)
    AND (SELECT encode(ciphertext,'hex') FROM competition_decision_states)='040506'
    AND (SELECT count(*) FROM ai_spend_budgets)=1
    AND (SELECT count(*) FROM ai_spend_authority WHERE singleton AND run_id='retention-test')=1
    AND NOT has_table_privilege('resume_ai_security_maintenance','ai_spend_authority','DELETE')
    AND (SELECT count(*) FROM ai_spend_ledger WHERE charged_micros=100 AND state='conservative')=1
    AND NOT has_table_privilege('resume_ai_security_maintenance','ai_spend_budgets','DELETE')
    AND NOT has_table_privilege('resume_ai_security_maintenance','ai_spend_ledger','DELETE')
    AND NOT has_column_privilege('resume_ai_security_maintenance','competition_decision_states','ciphertext','UPDATE')
    AND NOT has_table_privilege('resume_ai_security_maintenance','ai_consents','UPDATE')
    AND has_column_privilege('resume_ai_security_maintenance','ai_consents','created_at','UPDATE')
    AND NOT has_column_privilege('resume_ai_security_maintenance','ai_consents','payload','UPDATE');")"
[ "$cleanup_gate" = t ] || fail "cleanup or its minimal column privilege contract failed"
if PGDATABASE=resume_ai_ops_test "${PSQL[@]}" --command="SET ROLE resume_ai_security_maintenance; UPDATE ai_consents SET payload='forbidden';" >/dev/null 2>&1; then
  fail "maintenance role updated an unapproved payload column"
fi

cross_database_gate="$("${PSQL[@]}" --tuples-only --no-align --command="
  SELECT NOT has_database_privilege('resume_ai_ops_runtime','forbidden_ops_test','CONNECT')
    AND NOT has_database_privilege('resume_ai_ops_runtime','forbidden_ops_test','TEMP')
    AND NOT has_database_privilege('resume_ai_ops_runtime','forbidden_ops_test','CREATE');")"
[ "$cross_database_gate" = t ] || fail "runtime cross-database privileges remain effective"
if PGUSER=resume_ai_ops_runtime PGDATABASE=forbidden_ops_test "$PG_BINDIR/psql" --no-psqlrc \
  --command='SELECT 1' >/dev/null 2>&1; then
  fail "runtime role connected to a forbidden database"
fi

PGDATABASE=resume_ai_ops_test "${PSQL[@]}" <<'SQL'
ALTER TABLE ai_consents OWNER TO resume_ai_ops_owner;
REVOKE ALL ON TABLE ai_consents FROM PUBLIC,resume_ai_ops_runtime;
GRANT INSERT ON TABLE ai_consents TO resume_ai_ops_runtime;
CREATE FUNCTION resume_ai_ops_rpc() RETURNS boolean LANGUAGE sql SECURITY DEFINER
  SET search_path=pg_catalog AS 'SELECT true';
ALTER FUNCTION resume_ai_ops_rpc() OWNER TO resume_ai_ops_owner;
REVOKE ALL ON FUNCTION resume_ai_ops_rpc() FROM PUBLIC,resume_ai_ops_runtime;
GRANT EXECUTE ON FUNCTION resume_ai_ops_rpc() TO resume_ai_ops_runtime;
SQL
PGDATABASE=resume_ai_ops_test "$PG_BINDIR/pg_dump" --format=custom > "$TEST_ROOT/database.dump"
"$PG_BINDIR/createdb" --template=template0 resume_ai_ops_restore
"$PG_BINDIR/pg_restore" --exit-on-error --dbname=resume_ai_ops_restore "$TEST_ROOT/database.dump"
restore_gate="$(PGDATABASE=resume_ai_ops_restore "${PSQL[@]}" --tuples-only --no-align --command="
  SELECT pg_get_userbyid(c.relowner)='resume_ai_ops_owner'
    AND has_table_privilege('resume_ai_ops_runtime',c.oid,'INSERT')
    AND NOT has_table_privilege('resume_ai_ops_runtime',c.oid,'DELETE')
    AND pg_get_userbyid(p.proowner)='resume_ai_ops_owner'
    AND has_function_privilege('resume_ai_ops_runtime',p.oid,'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')
  FROM pg_class c,pg_proc p
  WHERE c.relname='ai_consents' AND p.proname='resume_ai_ops_rpc';")"
[ "$restore_gate" = t ] || fail "owner/ACL-preserving dump and restore contract failed"

PGDATABASE=resume_ai_ops_test "${PSQL[@]}" --command='CREATE TABLE migration_lock_probe(id integer);' >/dev/null
PGDATABASE=resume_ai_ops_test "${PSQL[@]}" --command='BEGIN; LOCK TABLE migration_lock_probe IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(8); ROLLBACK;' >/dev/null &
locker_pid=$!
sleep 1
lock_started=$SECONDS
if PGDATABASE=resume_ai_ops_test "${PSQL[@]}" --command="BEGIN; SET LOCAL lock_timeout='1s'; SET LOCAL statement_timeout='3s'; CREATE INDEX IF NOT EXISTS migration_lock_probe_idx ON migration_lock_probe(id); COMMIT;" >/dev/null 2>&1; then
  kill "$locker_pid" >/dev/null 2>&1 || true
  fail "migration lock contention unexpectedly passed"
fi
lock_elapsed=$((SECONDS-lock_started))
[ "$lock_elapsed" -le 4 ] || fail "migration lock timeout did not bound the wait"
wait "$locker_pid"

printf '%s\n' "PostgreSQL ops regression passed (cleanup, cross-db, owner/ACL restore, bounded DDL lock)."
