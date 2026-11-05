\set ON_ERROR_STOP on
\if :{?expected_session}
\else
  \set expected_session resume-ai-dbverify
\endif

-- Fixed production verification contract.  This file intentionally contains
-- catalog reads only; behavioral DML/RPC tests run against the disposable
-- PostgreSQL cluster created by deploy-release.sh.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout TO '5s';
SET LOCAL statement_timeout TO '30s';

SELECT current_user = :'expected_session'
   AND session_user = :'expected_session'
   AND current_setting('transaction_read_only') = 'on'
   AND current_setting('default_transaction_read_only') = 'on'
   AND inet_server_addr() IS NULL
   AS session_contract \gset
\if :session_contract
\else
  \echo 'read-only verifier session identity or local-peer contract failed'
  SELECT 1 / 0;
\endif

WITH required(name) AS (VALUES
  ('ai_model_daily_usage'),
  ('competition_rate_limit_counters'),
  ('competition_session_starts'),
  ('competition_sessions'),
  ('competition_session_transitions'),
  ('competition_idempotency'),
  ('ai_model_call_leases'),
  ('ai_model_call_waiters')
)
SELECT count(*) = 8
   AND count(*) FILTER (
     WHERE relation.relkind = 'r' AND relation.relpersistence = 'p'
   ) = 8
   AND count(DISTINCT relation.relowner) = 1
   AS relation_contract
FROM required
LEFT JOIN pg_catalog.pg_class relation ON relation.relname = required.name
LEFT JOIN pg_catalog.pg_namespace namespace
  ON namespace.oid = relation.relnamespace AND namespace.nspname = 'public'
WHERE namespace.oid IS NOT NULL \gset
\if :relation_contract
\else
  \echo 'required security-state relations are missing, malformed, or have mixed ownership'
  SELECT 1 / 0;
\endif

WITH required(name) AS (VALUES
  ('ai_model_daily_usage'),
  ('competition_rate_limit_counters'),
  ('competition_session_starts'),
  ('competition_sessions'),
  ('competition_session_transitions'),
  ('competition_idempotency'),
  ('ai_model_call_leases'),
  ('ai_model_call_waiters')
)
SELECT NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_class relation
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN required ON required.name = relation.relname
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
  ) privilege
  WHERE namespace.nspname = 'public' AND privilege.grantee = 0
) AS public_relation_acl_contract \gset
\if :public_relation_acl_contract
\else
  \echo 'PUBLIC retains a security-state relation privilege'
  SELECT 1 / 0;
\endif

WITH expected(table_name, column_name, data_type, not_null) AS (VALUES
  ('ai_model_daily_usage', 'usage_day', 'date', true),
  ('ai_model_daily_usage', 'bucket', 'text', true),
  ('ai_model_daily_usage', 'call_count', 'integer', true),
  ('ai_model_daily_usage', 'updated_at', 'timestamp with time zone', true),
  ('competition_rate_limit_counters', 'scope_key', 'text', true),
  ('competition_rate_limit_counters', 'hit_count', 'integer', true),
  ('competition_session_starts', 'start_key', 'text', true),
  ('competition_sessions', 'session_key', 'text', true),
  ('competition_session_transitions', 'session_key', 'text', true),
  ('competition_session_transitions', 'transition_key', 'text', true),
  ('competition_session_transitions', 'state', 'text', true),
  ('competition_idempotency', 'cache_key', 'text', true),
  ('competition_idempotency', 'owner_token', 'uuid', false),
  ('competition_idempotency', 'generation', 'integer', true),
  ('competition_idempotency', 'producer_retries', 'smallint', true),
  ('competition_idempotency', 'response_ciphertext', 'bytea', false),
  ('competition_idempotency', 'response_iv', 'bytea', false),
  ('competition_idempotency', 'response_tag', 'bytea', false),
  ('ai_model_call_leases', 'lease_id', 'uuid', true),
  ('ai_model_call_waiters', 'waiter_id', 'uuid', true)
)
SELECT NOT EXISTS (
  SELECT 1 FROM expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute observed
    JOIN pg_catalog.pg_class relation ON relation.oid = observed.attrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = expected.table_name
      AND observed.attname = expected.column_name
      AND observed.attnum > 0 AND NOT observed.attisdropped
      AND pg_catalog.format_type(observed.atttypid, observed.atttypmod) = expected.data_type
      AND observed.attnotnull = expected.not_null
  )
) AS column_contract \gset
\if :column_contract
\else
  \echo 'required security-state column contract failed'
  SELECT 1 / 0;
\endif

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_attribute column_info
  JOIN pg_catalog.pg_class relation ON relation.oid = column_info.attrelid
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname IN (
      'competition_rate_limit_counters', 'competition_session_starts',
      'competition_sessions', 'competition_session_transitions',
      'competition_idempotency', 'ai_model_call_leases', 'ai_model_call_waiters'
    )
    AND column_info.attnum > 0 AND NOT column_info.attisdropped
    -- owner_token is an opaque, single-flight lease nonce and is part of the
    -- fixed schema above; it is not a user/session/content token.
    AND column_info.attname <> 'owner_token'
    AND column_info.attname ~ '(answer|token|prompt|profile|payload|response_body|ip_address|session_id)'
) AS content_free_contract \gset
\if :content_free_contract
\else
  \echo 'shared security-state tables expose a forbidden content-bearing column'
  SELECT 1 / 0;
\endif

WITH required_primary_key(table_name, key_columns) AS (VALUES
  ('ai_model_daily_usage', ARRAY['usage_day', 'bucket']::text[]),
  ('competition_rate_limit_counters', ARRAY['bucket', 'scope_key']::text[]),
  ('competition_session_starts', ARRAY['start_key']::text[]),
  ('competition_sessions', ARRAY['session_key']::text[]),
  ('competition_session_transitions', ARRAY['session_key', 'transition_key']::text[]),
  ('competition_idempotency', ARRAY['cache_key']::text[]),
  ('ai_model_call_leases', ARRAY['lease_id']::text[]),
  ('ai_model_call_waiters', ARRAY['waiter_id']::text[])
)
SELECT NOT EXISTS (
  SELECT 1 FROM required_primary_key expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint constraint_info
    JOIN pg_catalog.pg_class relation ON relation.oid = constraint_info.conrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = expected.table_name
      AND constraint_info.contype = 'p'
      AND (
        SELECT array_agg(attribute.attname::text ORDER BY key_position.ordinality)
        FROM unnest(constraint_info.conkey) WITH ORDINALITY key_position(attnum, ordinality)
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = relation.oid AND attribute.attnum = key_position.attnum
      ) = expected.key_columns
  )
) AS primary_key_contract \gset
\if :primary_key_contract
\else
  \echo 'required primary-key contract failed'
  SELECT 1 / 0;
\endif

SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_constraint constraint_info
  JOIN pg_catalog.pg_class child ON child.oid = constraint_info.conrelid
  JOIN pg_catalog.pg_class parent ON parent.oid = constraint_info.confrelid
  JOIN pg_catalog.pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
  JOIN pg_catalog.pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace
  WHERE child_namespace.nspname = 'public'
    AND parent_namespace.nspname = 'public'
    AND child.relname = 'competition_session_transitions'
    AND parent.relname = 'competition_sessions'
    AND constraint_info.contype = 'f'
    AND constraint_info.confdeltype = 'c'
) AS session_cascade_contract \gset
\if :session_cascade_contract
\else
  \echo 'session-transition cascade contract failed'
  SELECT 1 / 0;
\endif

WITH expected(index_name, table_name, key_columns, partial) AS (VALUES
  ('idx_competition_rate_limit_reset', 'competition_rate_limit_counters', ARRAY['reset_at']::text[], false),
  ('idx_competition_session_starts_expiry', 'competition_session_starts', ARRAY['expires_at']::text[], false),
  ('idx_competition_sessions_expiry', 'competition_sessions', ARRAY['expires_at']::text[], false),
  ('idx_competition_session_transitions_expiry', 'competition_session_transitions', ARRAY['expires_at']::text[], false),
  ('idx_competition_idempotency_expiry', 'competition_idempotency', ARRAY['expires_at']::text[], false),
  ('idx_competition_idempotency_lease', 'competition_idempotency', ARRAY['lease_expires_at']::text[], true),
  ('idx_ai_model_call_leases_expiry', 'ai_model_call_leases', ARRAY['expires_at']::text[], false),
  ('idx_ai_model_call_waiters_order', 'ai_model_call_waiters', ARRAY['enqueued_at', 'waiter_id']::text[], false),
  ('idx_ai_model_call_waiters_expiry', 'ai_model_call_waiters', ARRAY['expires_at']::text[], false)
)
SELECT NOT EXISTS (
  SELECT 1 FROM expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class index_relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = index_relation.relnamespace
    JOIN pg_catalog.pg_index index_info ON index_info.indexrelid = index_relation.oid
    JOIN pg_catalog.pg_class table_relation ON table_relation.oid = index_info.indrelid
    WHERE namespace.nspname = 'public'
      AND index_relation.relname = expected.index_name
      AND table_relation.relname = expected.table_name
      AND index_info.indisvalid AND index_info.indisready
      AND (index_info.indpred IS NOT NULL) = expected.partial
      AND (
        SELECT array_agg(attribute.attname::text ORDER BY key_position.ordinality)
        FROM unnest(index_info.indkey) WITH ORDINALITY key_position(attnum, ordinality)
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = table_relation.oid AND attribute.attnum = key_position.attnum
      ) = expected.key_columns
      AND (NOT expected.partial OR
        pg_catalog.pg_get_expr(index_info.indpred, index_info.indrelid) ~ 'state.*pending')
  )
) AS index_contract \gset
\if :index_contract
\else
  \echo 'required security-state index contract failed'
  SELECT 1 / 0;
\endif

WITH expected(function_name, argument_types) AS (VALUES
  ('resume_ai_runtime_prune_competition_state', ''),
  ('resume_ai_runtime_delete_expired_session_start', 'text'),
  ('resume_ai_runtime_reset_expired_session_transitions', 'text'),
  ('resume_ai_runtime_delete_pending_transition', 'text, text'),
  ('resume_ai_runtime_prune_model_gate', ''),
  ('resume_ai_runtime_delete_model_waiter', 'uuid'),
  ('resume_ai_runtime_delete_model_lease', 'uuid')
)
SELECT NOT EXISTS (
  SELECT 1 FROM expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = expected.function_name
      AND pg_catalog.oidvectortypes(procedure.proargtypes) = expected.argument_types
      AND procedure.prosecdef
      AND procedure.provolatile = 'v'
      AND procedure.proparallel = 'u'
      AND (procedure.pronargs = 0 OR procedure.proisstrict)
      AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
  )
) AND NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname LIKE 'resume_ai_runtime_%'
    AND (procedure.proname, pg_catalog.oidvectortypes(procedure.proargtypes)) NOT IN (
      SELECT function_name, argument_types FROM expected
    )
) AS function_shape_contract \gset
\if :function_shape_contract
\else
  \echo 'runtime function inventory or security attributes failed'
  SELECT 1 / 0;
\endif

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
  ) privilege
  WHERE namespace.nspname = 'public'
    AND procedure.proname LIKE 'resume_ai_runtime_%'
    AND privilege.grantee = 0
    AND privilege.privilege_type = 'EXECUTE'
) AS public_function_acl_contract \gset
\if :public_function_acl_contract
\else
  \echo 'PUBLIC retains EXECUTE on a runtime function'
  SELECT 1 / 0;
\endif

SELECT count(DISTINCT object_owner) = 1 AS shared_owner_contract
FROM (
  SELECT relation.relowner AS object_owner
  FROM pg_catalog.pg_class relation
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname IN (
      'ai_model_daily_usage', 'competition_rate_limit_counters',
      'competition_session_starts', 'competition_sessions',
      'competition_session_transitions', 'competition_idempotency',
      'ai_model_call_leases', 'ai_model_call_waiters'
    )
  UNION ALL
  SELECT procedure.proowner
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname LIKE 'resume_ai_runtime_%'
) controlled_objects \gset
\if :shared_owner_contract
\else
  \echo 'security-state relations and runtime functions do not share one owner'
  SELECT 1 / 0;
\endif

ROLLBACK;
