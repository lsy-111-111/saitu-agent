\set ON_ERROR_STOP on

-- Installed root-owned outside application releases. The peer-authenticated
-- launcher immediately drops to a NOLOGIN role which has SELECT/DELETE plus
-- UPDATE on only each table's expiry/order column. Every table batch commits
-- independently, so a later timeout never rolls back completed work.
SET ROLE resume_ai_security_maintenance;
SET application_name = 'resume-ai-security-state-cleanup';
SET lock_timeout = '5s';
SET statement_timeout = '30s';

SELECT pg_catalog.pg_try_advisory_lock(724310896145222::bigint) AS cleanup_lock_acquired \gset
\if :cleanup_lock_acquired
\else
\echo CLEANUP_BUSY
\quit
\endif

BEGIN;
WITH expired AS (
  SELECT ctid FROM public.competition_idempotency
   WHERE expires_at <= pg_catalog.now()
   ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
)
DELETE FROM public.competition_idempotency target USING expired WHERE target.ctid=expired.ctid;
COMMIT;

BEGIN;
WITH expired AS (
  SELECT ctid FROM public.competition_session_transitions
   WHERE expires_at <= pg_catalog.now()
   ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
)
DELETE FROM public.competition_session_transitions target USING expired WHERE target.ctid=expired.ctid;
COMMIT;

BEGIN;
WITH expired AS (
  SELECT ctid FROM public.competition_session_starts
   WHERE expires_at <= pg_catalog.now()
   ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
)
DELETE FROM public.competition_session_starts target USING expired WHERE target.ctid=expired.ctid;
COMMIT;

BEGIN;
WITH expired AS (
  SELECT ctid FROM public.competition_sessions
   WHERE expires_at <= pg_catalog.now()
   ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
)
DELETE FROM public.competition_sessions target USING expired WHERE target.ctid=expired.ctid;
COMMIT;

BEGIN;
WITH expired AS (
  SELECT ctid FROM public.competition_rate_limit_counters
   WHERE reset_at <= pg_catalog.now()
   ORDER BY reset_at LIMIT 500 FOR UPDATE SKIP LOCKED
)
DELETE FROM public.competition_rate_limit_counters target USING expired WHERE target.ctid=expired.ctid;
COMMIT;

BEGIN;
WITH expired AS (
  SELECT ctid FROM public.ai_model_call_leases
   WHERE expires_at <= pg_catalog.now()
   ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
)
DELETE FROM public.ai_model_call_leases target USING expired WHERE target.ctid=expired.ctid;
COMMIT;

BEGIN;
WITH expired AS (
  SELECT ctid FROM public.ai_model_call_waiters
   WHERE expires_at <= pg_catalog.now()
   ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
)
DELETE FROM public.ai_model_call_waiters target USING expired WHERE target.ctid=expired.ctid;
COMMIT;

BEGIN;
WITH expired AS (
  SELECT ctid FROM public.ai_consents
   WHERE created_at <= pg_catalog.now() - interval '180 days'
   ORDER BY created_at LIMIT 500 FOR UPDATE SKIP LOCKED
)
DELETE FROM public.ai_consents target USING expired WHERE target.ctid=expired.ctid;
COMMIT;

SELECT (
  EXISTS (SELECT 1 FROM public.competition_idempotency WHERE expires_at <= pg_catalog.now())
  OR EXISTS (SELECT 1 FROM public.competition_session_transitions WHERE expires_at <= pg_catalog.now())
  OR EXISTS (SELECT 1 FROM public.competition_session_starts WHERE expires_at <= pg_catalog.now())
  OR EXISTS (SELECT 1 FROM public.competition_sessions WHERE expires_at <= pg_catalog.now())
  OR EXISTS (SELECT 1 FROM public.competition_rate_limit_counters WHERE reset_at <= pg_catalog.now())
  OR EXISTS (SELECT 1 FROM public.ai_model_call_leases WHERE expires_at <= pg_catalog.now())
  OR EXISTS (SELECT 1 FROM public.ai_model_call_waiters WHERE expires_at <= pg_catalog.now())
  OR EXISTS (SELECT 1 FROM public.ai_consents WHERE created_at <= pg_catalog.now()-interval '180 days')
) AS cleanup_remaining \gset
SELECT pg_catalog.pg_advisory_unlock(724310896145222::bigint);
\if :cleanup_remaining
\echo CLEANUP_REMAINING
\else
\echo CLEANUP_COMPLETE
\endif
RESET ROLE;
