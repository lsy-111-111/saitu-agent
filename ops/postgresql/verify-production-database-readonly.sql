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
  ('ai_model_call_waiters'),
  ('competition_decision_states'),
  ('ai_spend_budgets'),
  ('ai_spend_ledger'),
  ('ai_spend_authority'),
  ('ai_spend_development_batches'),
  ('competition_decision_runs'),
  ('competition_decision_calls'),
  ('competition_decision_chat_requests')
)
SELECT count(*) = 16
   AND count(*) FILTER (
     WHERE relation.relkind = 'r' AND relation.relpersistence = 'p'
   ) = 16
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
  ('ai_model_call_waiters'),
  ('competition_decision_states'),
  ('ai_spend_budgets'),
  ('ai_spend_ledger'),
  ('ai_spend_authority'),
  ('ai_spend_development_batches'),
  ('competition_decision_runs'),
  ('competition_decision_calls'),
  ('competition_decision_chat_requests')
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
  ('ai_model_call_waiters', 'waiter_id', 'uuid', true),
  ('competition_decision_states', 'state_key', 'text', true),
  ('competition_decision_states', 'generation', 'integer', true),
  ('competition_decision_states', 'ciphertext', 'bytea', true),
  ('competition_decision_states', 'iv', 'bytea', true),
  ('competition_decision_states', 'tag', 'bytea', true),
  ('competition_decision_states', 'expires_at', 'timestamp with time zone', true),
  ('ai_spend_budgets', 'execution_mode', 'text', false),
  ('ai_spend_budgets', 'run_id', 'text', true),
  ('ai_spend_budgets', 'hard_limit_micros', 'bigint', false),
  ('ai_spend_ledger', 'id', 'uuid', true),
  ('ai_spend_ledger', 'run_id', 'text', true),
  ('ai_spend_ledger', 'model', 'text', true),
  ('ai_spend_ledger', 'effort', 'text', true),
  ('ai_spend_ledger', 'phase', 'text', true),
  ('ai_spend_ledger', 'reserved_micros', 'bigint', true),
  ('ai_spend_ledger', 'charged_micros', 'bigint', false),
  ('ai_spend_ledger', 'state', 'text', true),
  ('ai_spend_ledger', 'operation', 'text', true),
  ('ai_spend_ledger', 'price_version', 'text', true),
  ('ai_spend_ledger', 'input_tokens', 'bigint', false),
  ('ai_spend_ledger', 'output_tokens', 'bigint', false),
  ('ai_spend_ledger', 'cached_input_tokens', 'bigint', false),
  ('ai_spend_ledger', 'created_at', 'timestamp with time zone', true),
  ('ai_spend_ledger', 'settled_at', 'timestamp with time zone', false),
  ('ai_spend_budgets', 'created_at', 'timestamp with time zone', true),
  ('competition_decision_states', 'created_at', 'timestamp with time zone', true),
  ('competition_decision_states', 'updated_at', 'timestamp with time zone', true),
  ('competition_decision_runs', 'execution_mode', 'text', false),
  ('competition_decision_runs', 'run_id', 'uuid', true),
  ('competition_decision_runs', 'state_key', 'text', true),
  ('competition_decision_runs', 'submission_key', 'text', true),
  ('competition_decision_runs', 'implementation_version', 'text', true),
  ('competition_decision_runs', 'status', 'text', true),
  ('competition_decision_runs', 'result_version', 'integer', true),
  ('competition_decision_runs', 'ciphertext', 'bytea', true),
  ('competition_decision_runs', 'iv', 'bytea', true),
  ('competition_decision_runs', 'tag', 'bytea', true),
  ('competition_decision_runs', 'submitted_at', 'timestamp with time zone', true),
  ('competition_decision_runs', 'list_deadline_at', 'timestamp with time zone', true),
  ('competition_decision_runs', 'detail_deadline_at', 'timestamp with time zone', true),
  ('competition_decision_runs', 'expires_at', 'timestamp with time zone', true),
  ('competition_decision_runs', 'lease_owner', 'text', false),
  ('competition_decision_runs', 'lease_fence', 'bigint', true),
  ('competition_decision_runs', 'lease_expires_at', 'timestamp with time zone', false),
  ('competition_decision_runs', 'updated_at', 'timestamp with time zone', true),
  ('competition_decision_calls', 'call_id', 'uuid', true),
  ('competition_decision_calls', 'run_id', 'uuid', true),
  ('competition_decision_calls', 'call_key', 'text', true),
  ('competition_decision_calls', 'prompt_sha256', 'text', true),
  ('competition_decision_calls', 'reservation_id', 'uuid', false),
  ('competition_decision_calls', 'state', 'text', true),
  ('competition_decision_calls', 'ciphertext', 'bytea', false),
  ('competition_decision_calls', 'iv', 'bytea', false),
  ('competition_decision_calls', 'tag', 'bytea', false),
  ('competition_decision_calls', 'created_at', 'timestamp with time zone', true),
  ('competition_decision_calls', 'dispatched_at', 'timestamp with time zone', false),
  ('competition_decision_calls', 'response_at', 'timestamp with time zone', false),
  ('competition_decision_calls', 'updated_at', 'timestamp with time zone', true),
  ('competition_decision_chat_requests', 'run_id', 'uuid', true),
  ('competition_decision_chat_requests', 'request_id', 'text', true),
  ('competition_decision_chat_requests', 'request_sha256', 'text', true),
  ('competition_decision_chat_requests', 'ciphertext', 'bytea', true),
  ('competition_decision_chat_requests', 'iv', 'bytea', true),
  ('competition_decision_chat_requests', 'tag', 'bytea', true),
  ('competition_decision_chat_requests', 'created_at', 'timestamp with time zone', true),
  ('competition_decision_chat_requests', 'updated_at', 'timestamp with time zone', true),
  ('ai_spend_development_batches', 'execution_mode', 'text', false),
  ('ai_spend_development_batches', 'run_id', 'text', true),
  ('ai_spend_development_batches', 'main_run_id', 'text', true),
  ('ai_spend_development_batches', 'call_limit', 'integer', false),
  ('ai_spend_development_batches', 'state', 'text', true),
  ('ai_spend_development_batches', 'provider_balance_micros', 'bigint', true),
  ('ai_spend_development_batches', 'protected_prior_micros', 'bigint', true),
  ('ai_spend_development_batches', 'funding_limit_micros', 'bigint', true),
  ('ai_spend_development_batches', 'baseline_reservation_ids', 'uuid[]', true),
  ('ai_spend_development_batches', 'authorization_note', 'text', true),
  ('ai_spend_development_batches', 'created_at', 'timestamp with time zone', true),
  ('ai_spend_development_batches', 'closed_at', 'timestamp with time zone', false),
  ('ai_spend_development_batches', 'authorized_effort', 'text', true),
  ('ai_spend_development_batches', 'effort_condition_sha256', 'text', false),
  ('ai_spend_development_batches', 'effort_condition', 'jsonb', false),
  ('ai_spend_development_batches', 'grant_version', 'text', true),
  ('ai_spend_development_batches', 'authorized_phase', 'text', true),
  ('ai_spend_development_batches', 'policy_sha256', 'text', false),
  ('ai_spend_ledger', 'effort_policy_sha256', 'text', false),
  ('ai_spend_development_batches', 'effort_policy', 'jsonb', false),
  ('ai_spend_development_batches', 'effort_policy_sha256', 'text', false),
  ('competition_decision_calls', 'operation', 'text', false),
  ('competition_decision_calls', 'dispatch_owner', 'text', false),
  ('competition_decision_calls', 'dispatch_fence', 'bigint', false),
  ('competition_decision_calls', 'thinking', 'text', false),
  ('competition_decision_calls', 'reasoning_effort', 'text', false),
  ('competition_decision_calls', 'effort_policy_sha256', 'text', false),
  ('ai_spend_authority', 'singleton', 'boolean', true),
  ('ai_spend_authority', 'run_id', 'text', true),
  ('ai_spend_authority', 'created_at', 'timestamp with time zone', true)
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
      'competition_idempotency', 'ai_model_call_leases', 'ai_model_call_waiters',
      'competition_decision_states', 'ai_spend_budgets', 'ai_spend_ledger', 'ai_spend_authority',
      'ai_spend_development_batches', 'competition_decision_runs', 'competition_decision_calls', 'competition_decision_chat_requests'
    )
    AND column_info.attnum > 0 AND NOT column_info.attisdropped
    -- owner_token is an opaque, single-flight lease nonce and is part of the
    -- fixed schema above; it is not a user/session/content token.
    AND column_info.attname <> 'owner_token'
    AND NOT (relation.relname='competition_decision_calls' AND column_info.attname='prompt_sha256')
    AND NOT (relation.relname='ai_spend_ledger' AND column_info.attname IN ('input_tokens','output_tokens','cached_input_tokens'))
    AND column_info.attname ~ '(answer|token|prompt|profile|payload|response_body|ip_address|session_id)'
) AS content_free_contract \gset
\if :content_free_contract
\else
  \echo 'shared security-state tables expose a forbidden content-bearing column'
  SELECT 1 / 0;
\endif


-- New state/budget tables admit only the explicit content-free schema. A renamed plaintext
-- field must not bypass the legacy keyword denylist. Token counters are numeric metadata.
WITH allowed(table_name, columns) AS (VALUES
 ('competition_decision_states',ARRAY['state_key','generation','ciphertext','iv','tag','expires_at','created_at','updated_at']),
 ('ai_spend_budgets',ARRAY['run_id','hard_limit_micros','created_at','execution_mode']),
 ('ai_spend_ledger',ARRAY['id','run_id','model','effort','phase','operation','price_version','reserved_micros','charged_micros','state','input_tokens','output_tokens','cached_input_tokens','created_at','settled_at','effort_policy_sha256']),
 ('competition_decision_runs',ARRAY['run_id','state_key','submission_key','implementation_version','status','result_version','ciphertext','iv','tag','submitted_at','list_deadline_at','detail_deadline_at','expires_at','lease_owner','lease_fence','lease_expires_at','updated_at','execution_mode']),
 ('competition_decision_calls',ARRAY['call_id','run_id','call_key','prompt_sha256','reservation_id','state','ciphertext','iv','tag','created_at','dispatched_at','response_at','updated_at','operation','dispatch_owner','dispatch_fence','thinking','reasoning_effort','effort_policy_sha256']),
 ('competition_decision_chat_requests',ARRAY['run_id','request_id','request_sha256','ciphertext','iv','tag','created_at','updated_at']),
 ('ai_spend_development_batches',ARRAY['run_id','main_run_id','call_limit','state','provider_balance_micros','protected_prior_micros','funding_limit_micros','baseline_reservation_ids','authorization_note','created_at','closed_at','authorized_effort','effort_condition_sha256','effort_condition','grant_version','authorized_phase','policy_sha256','effort_policy','effort_policy_sha256','execution_mode']),
 ('ai_spend_authority',ARRAY['singleton','run_id','created_at'])
)
SELECT NOT EXISTS(SELECT 1 FROM allowed JOIN pg_catalog.pg_class c ON c.relname=allowed.table_name
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 WHERE NOT (a.attname=ANY(allowed.columns))) AS exact_content_free_contract \gset
\if :exact_content_free_contract
\else
 \echo 'new state/budget table contains a non-allowlisted content column'
 SELECT 1/0;
\endif

WITH expected(table_name, expression) AS (VALUES
 ('ai_spend_budgets',$expr$((((execution_mode IS NULL) AND (hard_limit_micros IS NOT NULL)) OR ((execution_mode = 'user-unbounded'::text) AND (hard_limit_micros IS NULL))) IS TRUE)$expr$),
 ('ai_spend_development_batches',$expr$((((execution_mode IS NULL) AND (call_limit IS NOT NULL) AND (grant_version <> 'saitu.v7.top5.user-unbounded.v1'::text)) OR ((execution_mode = 'user-unbounded'::text) AND (call_limit IS NULL) AND (grant_version = 'saitu.v7.top5.user-unbounded.v1'::text))) IS TRUE)$expr$),
 ('competition_decision_runs',$expr$(execution_mode = ANY (ARRAY['finite'::text, 'user-unbounded'::text]))$expr$),
 ('competition_decision_runs',$expr$(submission_key ~ '^[0-9a-f]{64}$'::text)$expr$),
 ('competition_decision_runs',$expr$(status = ANY (ARRAY['queued'::text, 'ranking'::text, 'list_ready'::text, 'explaining'::text, 'partial_ready'::text, 'ready'::text, 'failed'::text, 'superseded'::text, 'expired'::text]))$expr$),
 ('competition_decision_runs',$expr$(result_version >= 0)$expr$),
 ('competition_decision_runs',$expr$(octet_length(ciphertext) <= 8388608)$expr$),
 ('competition_decision_runs',$expr$(octet_length(iv) = 12)$expr$),
 ('competition_decision_runs',$expr$(octet_length(tag) = 16)$expr$),
 ('competition_decision_runs',$expr$((list_deadline_at > submitted_at) AND (detail_deadline_at >= list_deadline_at) AND (expires_at > detail_deadline_at))$expr$),
 ('competition_decision_chat_requests',$expr$(request_sha256 ~ '^[0-9a-f]{64}$'::text)$expr$),
 ('competition_decision_chat_requests',$expr$(octet_length(ciphertext) <= 8388608)$expr$),
 ('competition_decision_chat_requests',$expr$(octet_length(iv) = 12)$expr$),
 ('competition_decision_chat_requests',$expr$(octet_length(tag) = 16)$expr$),
 ('ai_spend_development_batches',$expr$(authorized_effort = ANY (ARRAY['max'::text, 'high'::text, 'stage'::text]))$expr$),
 ('ai_spend_development_batches',$expr$(call_limit > 0)$expr$),
 ('ai_spend_development_batches',$expr$(run_id <> main_run_id)$expr$),
 ('ai_spend_development_batches',$expr$(funding_limit_micros <= (provider_balance_micros - protected_prior_micros))$expr$),
 ('ai_spend_development_batches',$expr$(((state = 'active'::text) AND (closed_at IS NULL)) OR ((state = 'closed'::text) AND (closed_at IS NOT NULL)))$expr$),
 ('ai_spend_development_batches',$expr$(funding_limit_micros > 0)$expr$),
 ('ai_spend_development_batches',$expr$(protected_prior_micros >= 0)$expr$),
 ('ai_spend_development_batches',$expr$(provider_balance_micros > 0)$expr$),
 ('ai_spend_development_batches',$expr$(state = ANY (ARRAY['active'::text, 'closed'::text]))$expr$),
 ('ai_spend_development_batches',$expr$((((grant_version = 'legacy'::text) AND (authorized_phase = 'calibration'::text) AND (policy_sha256 IS NULL) AND (effort_policy IS NULL) AND (effort_policy_sha256 IS NULL) AND (((authorized_effort = 'max'::text) AND (effort_condition_sha256 IS NULL) AND (effort_condition IS NULL)) OR ((authorized_effort = 'high'::text) AND (effort_condition_sha256 ~ '^[a-f0-9]{64}$'::text) AND (effort_condition IS NOT NULL) AND ((effort_condition ->> 'schemaVersion'::text) = 'saitu.max-failure-budget-condition.v1'::text) AND ((effort_condition ->> 'initialEffort'::text) = 'max'::text) AND ((effort_condition ->> 'nextPermittedEffort'::text) = 'high'::text) AND ((effort_condition ->> 'sourceRunId'::text) <> run_id) AND ((effort_condition ->> 'freshPgRowsVerified'::text) = 'true'::text)))) OR ((grant_version = 'saitu.v7'::text) AND (authorized_phase = ANY (ARRAY['calibration'::text, 'formal'::text, 'repair'::text, 'performance'::text, 'reserve'::text])) AND (policy_sha256 ~ '^[a-f0-9]{64}$'::text) AND (authorized_effort = 'high'::text) AND (effort_policy IS NULL) AND (effort_policy_sha256 IS NULL) AND (effort_condition_sha256 ~ '^[a-f0-9]{64}$'::text) AND (effort_condition IS NOT NULL) AND ((effort_condition ->> 'schemaVersion'::text) = 'saitu.user-approved-budget-condition.v7'::text) AND ((effort_condition ->> 'model'::text) = 'deepseek-flash'::text) AND ((effort_condition ->> 'effort'::text) = 'high'::text) AND ((effort_condition ->> 'phase'::text) = authorized_phase) AND ((effort_condition ->> 'policySha256'::text) = policy_sha256) AND ((effort_condition ->> 'authorization'::text) = 'user-approved-20261109-continuation'::text) AND ((effort_condition ->> 'freshPgRowsVerified'::text) = 'true'::text)) OR ((grant_version = 'saitu.v7.effort.v1'::text) AND (authorized_phase = ANY (ARRAY['calibration'::text, 'formal'::text, 'repair'::text, 'performance'::text, 'reserve'::text])) AND (policy_sha256 ~ '^[a-f0-9]{64}$'::text) AND (authorized_effort = 'stage'::text) AND (effort_policy_sha256 ~ '^[a-f0-9]{64}$'::text) AND (jsonb_typeof(effort_policy) = 'object'::text) AND ((effort_policy - ARRAY['version'::text, 'rank'::text, 'explain'::text, 'review'::text]) = '{}'::jsonb) AND ((effort_policy ->> 'version'::text) = 'saitu.effort-policy.v1'::text) AND ((effort_policy ->> 'rank'::text) = ANY (ARRAY['high'::text, 'low'::text])) AND ((effort_policy ->> 'explain'::text) = ANY (ARRAY['high'::text, 'low'::text])) AND ((effort_policy ->> 'review'::text) = ANY (ARRAY['high'::text, 'low'::text])) AND (effort_condition_sha256 ~ '^[a-f0-9]{64}$'::text) AND (effort_condition IS NOT NULL) AND ((effort_condition ->> 'schemaVersion'::text) = 'saitu.user-approved-budget-condition.v7.effort.v1'::text) AND ((effort_condition ->> 'model'::text) = 'deepseek-flash'::text) AND ((effort_condition ->> 'effort'::text) = 'stage'::text) AND ((effort_condition ->> 'mainRunId'::text) = main_run_id) AND ((effort_condition ->> 'phase'::text) = authorized_phase) AND ((effort_condition ->> 'policySha256'::text) = policy_sha256) AND ((effort_condition -> 'effortPolicy'::text) = effort_policy) AND ((effort_condition ->> 'effortPolicySha256'::text) = effort_policy_sha256) AND ((effort_condition ->> 'authorization'::text) = 'user-approved-20261109-effort-exploration'::text) AND ((effort_condition ->> 'freshPgRowsVerified'::text) = 'true'::text)) OR ((grant_version = 'saitu.v7.top5.v1'::text) AND (run_id ~ (('^saitu-v7-top5-20261109-'::text || authorized_phase) || '-[0-9]{2}$'::text)) AND (authorized_phase = ANY (ARRAY['calibration'::text, 'formal'::text, 'repair'::text, 'performance'::text, 'reserve'::text])) AND (policy_sha256 ~ '^[a-f0-9]{64}$'::text) AND (authorized_effort = 'stage'::text) AND (effort_policy_sha256 ~ '^[a-f0-9]{64}$'::text) AND (jsonb_typeof(effort_policy) = 'object'::text) AND (effort_policy = '{"rank": "low", "review": "low", "explain": "low", "version": "saitu.effort-policy.v1"}'::jsonb) AND (effort_condition_sha256 ~ '^[a-f0-9]{64}$'::text) AND (jsonb_typeof(effort_condition) = 'object'::text) AND ((effort_condition ->> 'schemaVersion'::text) = 'saitu.user-approved-budget-condition.v7.top5.v1'::text) AND ((effort_condition ->> 'model'::text) = 'deepseek-flash'::text) AND ((effort_condition ->> 'effort'::text) = 'stage'::text) AND ((effort_condition ->> 'mainRunId'::text) = main_run_id) AND ((effort_condition ->> 'phase'::text) = authorized_phase) AND ((effort_condition ->> 'policySha256'::text) = policy_sha256) AND ((effort_condition -> 'effortPolicy'::text) = effort_policy) AND ((effort_condition ->> 'effortPolicySha256'::text) = effort_policy_sha256) AND ((effort_condition ->> 'sourcePolicy'::text) = 'docs/v7/top5-continuation-contract-20261109.md'::text) AND ((effort_condition ->> 'policyVersion'::text) = 'saitu.policy.2026-11-09.v7.top5'::text) AND ((effort_condition ->> 'implementationVersion'::text) = 'saitu.async.2026-11-09.v7.3.top5'::text) AND ((effort_condition ->> 'authorization'::text) = 'user-approved-20261109-top5-continuation'::text) AND ((effort_condition ->> 'priorLedgerSha256'::text) ~ '^[a-f0-9]{64}$'::text) AND ((effort_condition ->> 'freshPgRowsVerified'::text) = 'true'::text)) OR ((grant_version = 'saitu.v7.top5.user-unbounded.v1'::text) AND (execution_mode = 'user-unbounded'::text) AND (call_limit IS NULL) AND (run_id ~ (('^saitu-v7-top5-unbounded-20261109-'::text || authorized_phase) || '-[0-9]{2}$'::text)) AND (authorized_phase = ANY (ARRAY['calibration'::text, 'formal'::text, 'repair'::text, 'performance'::text, 'reserve'::text])) AND (policy_sha256 ~ '^[a-f0-9]{64}$'::text) AND (authorized_effort = 'stage'::text) AND (effort_policy_sha256 ~ '^[a-f0-9]{64}$'::text) AND (jsonb_typeof(effort_policy) = 'object'::text) AND (effort_policy = '{"rank": "low", "review": "low", "explain": "low", "version": "saitu.effort-policy.v1"}'::jsonb) AND (effort_condition_sha256 ~ '^[a-f0-9]{64}$'::text) AND (jsonb_typeof(effort_condition) = 'object'::text) AND ((effort_condition ->> 'schemaVersion'::text) = 'saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1'::text) AND ((effort_condition ->> 'model'::text) = 'deepseek-flash'::text) AND ((effort_condition ->> 'effort'::text) = 'stage'::text) AND ((effort_condition ->> 'mainRunId'::text) = main_run_id) AND ((effort_condition ->> 'phase'::text) = authorized_phase) AND ((effort_condition ->> 'policySha256'::text) = policy_sha256) AND ((effort_condition -> 'effortPolicy'::text) = effort_policy) AND ((effort_condition ->> 'effortPolicySha256'::text) = effort_policy_sha256) AND ((effort_condition ->> 'sourcePolicy'::text) = 'docs/v7/top5-unbounded-execution-contract-20261109.md'::text) AND ((effort_condition ->> 'policyVersion'::text) = 'saitu.policy.2026-11-09.v7.top5'::text) AND ((effort_condition ->> 'implementationVersion'::text) = 'saitu.async.2026-11-09.v7.3.top5'::text) AND ((effort_condition ->> 'authorization'::text) = 'user-approved-20261109-top5-unbounded-execution'::text) AND ((effort_condition ->> 'priorLedgerSha256'::text) ~ '^[a-f0-9]{64}$'::text) AND ((effort_condition ->> 'executionMode'::text) = 'user-unbounded'::text) AND ((effort_condition -> 'executionLimits'::text) = '{"totalCallLimit": null, "totalCostLimitMicros": null, "modelConcurrencyLimit": null}'::jsonb) AND ((effort_condition ->> 'freshPgRowsVerified'::text) = 'true'::text))) IS TRUE)$expr$),
 ('ai_spend_development_batches',$expr$(grant_version = ANY (ARRAY['legacy'::text, 'saitu.v7'::text, 'saitu.v7.effort.v1'::text, 'saitu.v7.top5.v1'::text, 'saitu.v7.top5.user-unbounded.v1'::text]))$expr$),
 ('ai_spend_ledger',$expr$(charged_micros >= 0)$expr$),
 ('ai_spend_ledger',$expr$(((state = 'reserved'::text) AND (charged_micros IS NULL)) OR ((state <> 'reserved'::text) AND (charged_micros IS NOT NULL)))$expr$),
 ('ai_spend_ledger',$expr$(effort = ANY (ARRAY['max'::text, 'high'::text, 'low'::text]))$expr$),
 ('ai_spend_ledger',$expr$(effort_policy_sha256 ~ '^[a-f0-9]{64}$'::text)$expr$),
 ('ai_spend_ledger',$expr$(model = 'deepseek-flash'::text)$expr$),
 ('ai_spend_ledger',$expr$(phase = ANY (ARRAY['calibration'::text, 'formal'::text, 'repair'::text, 'performance'::text, 'reserve'::text]))$expr$),
 ('ai_spend_ledger',$expr$(reserved_micros >= 0)$expr$),
 ('ai_spend_ledger',$expr$(state = ANY (ARRAY['reserved'::text, 'usage_estimated'::text, 'conservative'::text, 'cancelled'::text]))$expr$),
 ('competition_decision_calls',$expr$(octet_length(ciphertext) <= 1048576)$expr$),
 ('competition_decision_calls',$expr$(effort_policy_sha256 ~ '^[a-f0-9]{64}$'::text)$expr$),
 ('competition_decision_calls',$expr$(octet_length(iv) = 12)$expr$),
 ('competition_decision_calls',$expr$(prompt_sha256 ~ '^[0-9a-f]{64}$'::text)$expr$),
 ('competition_decision_calls',$expr$(reasoning_effort = ANY (ARRAY['max'::text, 'high'::text, 'low'::text]))$expr$),
 ('competition_decision_calls',$expr$(state = ANY (ARRAY['prepared'::text, 'reserved'::text, 'dispatch_intent'::text, 'response_received'::text, 'unknown'::text, 'completed'::text]))$expr$),
 ('competition_decision_calls',$expr$(octet_length(tag) = 16)$expr$),
 ('competition_decision_calls',$expr$(thinking = 'enabled'::text)$expr$),
 ('ai_spend_authority',$expr$singleton$expr$),
 ('ai_spend_budgets',$expr$((hard_limit_micros > 0) AND (hard_limit_micros <= 300000000))$expr$),
 ('competition_decision_states',$expr$(state_key ~ '^[0-9a-f]{64}$'::text)$expr$),
 ('competition_decision_states',$expr$(generation >= 0)$expr$),
 ('competition_decision_states',$expr$(octet_length(ciphertext) <= 1048576)$expr$),
 ('competition_decision_states',$expr$(octet_length(iv) = 12)$expr$),
 ('competition_decision_states',$expr$(octet_length(tag) = 16)$expr$),
 ('ai_spend_ledger',$expr$(((state = 'reserved'::text) AND (charged_micros IS NULL)) OR ((state <> 'reserved'::text) AND (charged_micros IS NOT NULL)))$expr$)
)
SELECT NOT EXISTS(SELECT 1 FROM expected WHERE NOT EXISTS(
 SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname=expected.table_name AND k.contype='c' AND k.convalidated AND NOT k.connoinherit
 AND regexp_replace(pg_catalog.pg_get_expr(k.conbin,k.conrelid),'[[:space:]]','','g')=regexp_replace(expected.expression,'[[:space:]]','','g')
)) AS budget_state_checks_contract \gset
\if :budget_state_checks_contract
\else
 \echo 'budget/state validated CHECK constraint contract failed'
 SELECT 1/0;
\endif

-- The named marker prevents the administrator installer from replaying older,
-- narrower grant predicates over an already upgraded Top5 database.
SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k
 JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='ai_spend_development_batches'
 AND k.conname='ai_spend_top5_grant_check' AND k.contype='c'
 AND k.convalidated AND NOT k.connoinherit
 AND regexp_replace(pg_catalog.pg_get_expr(k.conbin,k.conrelid),'[[:space:]]','','g')=
     regexp_replace($expr$(grant_version = ANY (ARRAY['legacy'::text, 'saitu.v7'::text, 'saitu.v7.effort.v1'::text, 'saitu.v7.top5.v1'::text, 'saitu.v7.top5.user-unbounded.v1'::text]))$expr$,'[[:space:]]','','g'))
 AS top5_installation_marker_contract \gset
\if :top5_installation_marker_contract
\else
 \echo 'Top5 installation marker CHECK constraint contract failed'
 SELECT 1/0;
\endif

WITH expected(child) AS (VALUES ('ai_spend_ledger'),('ai_spend_authority'))
SELECT NOT EXISTS(SELECT 1 FROM expected WHERE NOT EXISTS(
 SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_class parent ON parent.oid=k.confrelid
 JOIN pg_catalog.pg_namespace pn ON pn.oid=parent.relnamespace
 WHERE n.nspname='public' AND pn.nspname='public' AND c.relname=expected.child AND parent.relname='ai_spend_budgets'
 AND k.contype='f' AND k.convalidated AND NOT k.condeferrable AND k.confdeltype='a' AND k.confupdtype='a'
 AND k.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.oid AND attname='run_id')]::smallint[]
 AND k.confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=parent.oid AND attname='run_id')]::smallint[]
)) AS budget_foreign_keys_contract \gset
\if :budget_foreign_keys_contract
\else
 \echo 'budget run foreign key contract failed'
 SELECT 1/0;
\endif

WITH required_primary_key(table_name, key_columns) AS (VALUES
  ('ai_model_daily_usage', ARRAY['usage_day', 'bucket']::text[]),
  ('competition_rate_limit_counters', ARRAY['bucket', 'scope_key']::text[]),
  ('competition_session_starts', ARRAY['start_key']::text[]),
  ('competition_sessions', ARRAY['session_key']::text[]),
  ('competition_session_transitions', ARRAY['session_key', 'transition_key']::text[]),
  ('competition_idempotency', ARRAY['cache_key']::text[]),
  ('ai_model_call_leases', ARRAY['lease_id']::text[]),
  ('ai_model_call_waiters', ARRAY['waiter_id']::text[]),
  ('competition_decision_states', ARRAY['state_key']::text[]),
  ('ai_spend_budgets', ARRAY['run_id']::text[]),
  ('ai_spend_ledger', ARRAY['id']::text[]),
  ('ai_spend_authority', ARRAY['singleton']::text[]),
  ('ai_spend_development_batches', ARRAY['run_id']::text[]),
  ('competition_decision_runs', ARRAY['run_id']::text[]),
  ('competition_decision_calls', ARRAY['call_id']::text[]),
  ('competition_decision_chat_requests', ARRAY['run_id','request_id']::text[])
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
  ('idx_ai_model_call_waiters_expiry', 'ai_model_call_waiters', ARRAY['expires_at']::text[], false),
  ('idx_competition_decision_states_expiry', 'competition_decision_states', ARRAY['expires_at']::text[], false),
  ('idx_ai_spend_ledger_run', 'ai_spend_ledger', ARRAY['run_id']::text[], false),
  ('idx_decision_runs_claim', 'competition_decision_runs', ARRAY['implementation_version','status','submitted_at']::text[], false),
  ('idx_decision_runs_expiry', 'competition_decision_runs', ARRAY['expires_at']::text[], false),
  ('idx_decision_runs_state', 'competition_decision_runs', ARRAY['state_key']::text[], false)
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
      'ai_model_call_leases', 'ai_model_call_waiters',
      'competition_decision_states', 'ai_spend_budgets', 'ai_spend_ledger', 'ai_spend_authority',
      'ai_spend_development_batches', 'competition_decision_runs', 'competition_decision_calls', 'competition_decision_chat_requests'
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


WITH expected(child, child_column, parent, parent_column) AS (VALUES
 ('competition_decision_runs','state_key','competition_decision_states','state_key'),
 ('competition_decision_calls','run_id','competition_decision_runs','run_id'),
 ('competition_decision_calls','reservation_id','ai_spend_ledger','id'),
 ('competition_decision_chat_requests','run_id','competition_decision_runs','run_id'),
 ('ai_spend_development_batches','run_id','ai_spend_budgets','run_id'),
 ('ai_spend_development_batches','main_run_id','ai_spend_budgets','run_id')
)
SELECT NOT EXISTS(SELECT 1 FROM expected WHERE NOT EXISTS(
 SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_class p ON p.oid=k.confrelid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.relnamespace
 WHERE n.nspname='public' AND pn.nspname='public' AND c.relname=expected.child AND p.relname=expected.parent
 AND k.contype='f' AND k.convalidated AND NOT k.condeferrable AND k.confdeltype='a' AND k.confupdtype='a'
 AND k.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.oid AND attname=expected.child_column)]::smallint[]
 AND k.confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=p.oid AND attname=expected.parent_column)]::smallint[]
)) AS decision_foreign_keys_contract \gset
\if :decision_foreign_keys_contract
\else
 \echo 'v7 decision/development foreign key contract failed'
 SELECT 1/0;
\endif

WITH expected(table_name, key_columns) AS (VALUES
 ('competition_decision_runs',ARRAY['submission_key']::text[]),
 ('competition_decision_calls',ARRAY['run_id','call_key']::text[]),
 ('competition_decision_calls',ARRAY['reservation_id']::text[])
)
SELECT NOT EXISTS(SELECT 1 FROM expected WHERE NOT EXISTS(
 SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname=expected.table_name AND k.contype='u' AND k.convalidated AND NOT k.condeferrable
 AND (SELECT array_agg(a.attname::text ORDER BY position.ordinality)
   FROM unnest(k.conkey) WITH ORDINALITY position(attnum,ordinality)
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=position.attnum)=expected.key_columns
)) AS decision_unique_contract \gset
\if :decision_unique_contract
\else
 \echo 'v7 decision idempotency uniqueness contract failed'
 SELECT 1/0;
\endif

ROLLBACK;
