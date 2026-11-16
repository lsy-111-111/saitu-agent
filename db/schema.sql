-- Active schema for fresh self-hosted PostgreSQL installations.
-- Existing legacy tables are intentionally not dropped when this file is applied.

create extension if not exists pgcrypto;

create table if not exists ai_consents (
  id uuid primary key default gen_random_uuid(),
  ip_hash text,
  consent_version text not null,
  purpose text not null,
  provider text,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_consents_created on ai_consents (created_at desc);

create table if not exists ai_model_daily_usage (
  usage_day date not null,
  bucket text not null,
  call_count integer not null check (call_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (usage_day, bucket)
);

revoke all on table ai_model_daily_usage from public;

-- Shared competition security state. Identifiers are secret-derived HMACs and
-- response material is AES-256-GCM ciphertext produced by the application.
create table if not exists competition_rate_limit_counters (
  bucket text not null check (bucket in ('session_start_minute', 'session_start_daily')),
  scope_key text not null check (scope_key ~ '^[0-9a-f]{64}$'),
  hit_count integer not null check (hit_count > 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (bucket, scope_key)
);
create index if not exists idx_competition_rate_limit_reset
  on competition_rate_limit_counters (reset_at);

create table if not exists competition_session_starts (
  start_key text primary key check (start_key ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_competition_session_starts_expiry
  on competition_session_starts (expires_at);

create table if not exists competition_sessions (
  session_key text primary key check (session_key ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_competition_sessions_expiry
  on competition_sessions (expires_at);

create table if not exists competition_session_transitions (
  session_key text not null references competition_sessions (session_key) on delete cascade,
  transition_key text not null check (transition_key ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('pending', 'committed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_key, transition_key)
);
create index if not exists idx_competition_session_transitions_expiry
  on competition_session_transitions (expires_at);

create table if not exists competition_idempotency (
  cache_key text primary key check (cache_key ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('pending', 'completed', 'retryable')),
  owner_token uuid,
  generation integer not null default 1 check (generation > 0),
  producer_retries smallint not null default 0 check (producer_retries between 0 and 2),
  retry_kind text check (retry_kind in ('no_store', 'failure')),
  expires_at timestamptz not null,
  lease_expires_at timestamptz,
  response_ciphertext bytea,
  response_iv bytea,
  response_tag bytea,
  response_bytes integer check (response_bytes between 0 and 1048604),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (state = 'pending' and owner_token is not null and lease_expires_at is not null and retry_kind is null)
    or (state <> 'pending' and owner_token is null and lease_expires_at is null)
  ),
  check (
    state = 'pending'
    or (state = 'completed' and retry_kind is null)
    or (state = 'retryable' and retry_kind is not null)
  ),
  check (
    (response_ciphertext is null and response_iv is null and response_tag is null and response_bytes is null)
    or (response_ciphertext is not null and response_iv is not null and octet_length(response_iv) = 12
      and response_tag is not null and octet_length(response_tag) = 16
      and octet_length(response_ciphertext) <= 1048576
      and response_bytes = octet_length(response_ciphertext) + 28)
  ),
  check (state <> 'completed' or response_ciphertext is not null)
);
create index if not exists idx_competition_idempotency_expiry
  on competition_idempotency (expires_at);
create index if not exists idx_competition_idempotency_lease
  on competition_idempotency (lease_expires_at) where state = 'pending';

create table if not exists ai_model_call_leases (
  lease_id uuid primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ai_model_call_leases_expiry
  on ai_model_call_leases (expires_at);

create table if not exists ai_model_call_waiters (
  waiter_id uuid primary key,
  expires_at timestamptz not null,
  enqueued_at timestamptz not null default now()
);
create index if not exists idx_ai_model_call_waiters_order
  on ai_model_call_waiters (enqueued_at, waiter_id);
create index if not exists idx_ai_model_call_waiters_expiry
  on ai_model_call_waiters (expires_at);

revoke all on table competition_rate_limit_counters from public;
revoke all on table competition_session_starts from public;
revoke all on table competition_sessions from public;
revoke all on table competition_session_transitions from public;
revoke all on table competition_idempotency from public;
revoke all on table ai_model_call_leases from public;
revoke all on table ai_model_call_waiters from public;

-- The application runtime is intentionally not granted table DELETE. These
-- fixed-predicate, owner-executed functions are its only deletion capabilities.
create or replace function public.resume_ai_runtime_prune_competition_state()
returns integer
language plpgsql
volatile
parallel unsafe
security definer
set search_path = pg_catalog
as $function$
declare
  affected integer;
  total_affected integer := 0;
begin
  delete from public.competition_idempotency target
   where target.ctid in (
     select candidate.ctid from public.competition_idempotency candidate
      where candidate.expires_at <= pg_catalog.now()
      order by candidate.expires_at limit 500 for update skip locked
   );
  get diagnostics affected = row_count;
  total_affected := total_affected + affected;
  delete from public.competition_session_starts target
   where target.ctid in (
     select candidate.ctid from public.competition_session_starts candidate
      where candidate.expires_at <= pg_catalog.now()
      order by candidate.expires_at limit 500 for update skip locked
   );
  get diagnostics affected = row_count;
  total_affected := total_affected + affected;
  delete from public.competition_sessions target
   where target.ctid in (
     select candidate.ctid from public.competition_sessions candidate
      where candidate.expires_at <= pg_catalog.now()
      order by candidate.expires_at limit 500 for update skip locked
   );
  get diagnostics affected = row_count;
  total_affected := total_affected + affected;
  delete from public.competition_rate_limit_counters target
   where target.ctid in (
     select candidate.ctid from public.competition_rate_limit_counters candidate
      where candidate.reset_at <= pg_catalog.now()
      order by candidate.reset_at limit 500 for update skip locked
   );
  get diagnostics affected = row_count;
  return total_affected + affected;
end
$function$;

create or replace function public.resume_ai_runtime_delete_expired_session_start(
  p_start_key text
)
returns boolean language plpgsql strict volatile parallel unsafe security definer
set search_path = pg_catalog
as $function$
declare affected integer;
begin
  if p_start_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid hashed session-start key' using errcode = '22023';
  end if;
  delete from public.competition_session_starts
   where start_key = p_start_key and expires_at <= pg_catalog.now();
  get diagnostics affected = row_count;
  return affected = 1;
end
$function$;

create or replace function public.resume_ai_runtime_reset_expired_session_transitions(
  p_session_key text
)
returns integer language plpgsql strict volatile parallel unsafe security definer
set search_path = pg_catalog
as $function$
declare affected integer;
begin
  if p_session_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid hashed session key' using errcode = '22023';
  end if;
  delete from public.competition_session_transitions transition
   where transition.session_key = p_session_key
     and exists (
       select 1 from public.competition_sessions session
        where session.session_key = p_session_key
          and session.expires_at <= pg_catalog.now()
     );
  get diagnostics affected = row_count;
  return affected;
end
$function$;

create or replace function public.resume_ai_runtime_delete_pending_transition(
  p_session_key text,
  p_transition_key text
)
returns boolean language plpgsql strict volatile parallel unsafe security definer
set search_path = pg_catalog
as $function$
declare affected integer;
begin
  if p_session_key !~ '^[0-9a-f]{64}$'
     or p_transition_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid hashed transition key' using errcode = '22023';
  end if;
  delete from public.competition_session_transitions
   where session_key = p_session_key
     and transition_key = p_transition_key
     and state = 'pending';
  get diagnostics affected = row_count;
  return affected = 1;
end
$function$;

create or replace function public.resume_ai_runtime_prune_model_gate()
returns integer language plpgsql volatile parallel unsafe security definer
set search_path = pg_catalog
as $function$
declare affected integer; total_affected integer := 0;
begin
  delete from public.ai_model_call_leases where expires_at <= pg_catalog.now();
  get diagnostics affected = row_count;
  total_affected := total_affected + affected;
  delete from public.ai_model_call_waiters where expires_at <= pg_catalog.now();
  get diagnostics affected = row_count;
  return total_affected + affected;
end
$function$;

create or replace function public.resume_ai_runtime_delete_model_waiter(p_waiter_id uuid)
returns boolean language plpgsql strict volatile parallel unsafe security definer
set search_path = pg_catalog
as $function$
declare affected integer;
begin
  delete from public.ai_model_call_waiters where waiter_id = p_waiter_id;
  get diagnostics affected = row_count;
  return affected = 1;
end
$function$;

create or replace function public.resume_ai_runtime_delete_model_lease(p_lease_id uuid)
returns boolean language plpgsql strict volatile parallel unsafe security definer
set search_path = pg_catalog
as $function$
declare affected integer;
begin
  delete from public.ai_model_call_leases where lease_id = p_lease_id;
  get diagnostics affected = row_count;
  return affected = 1;
end
$function$;

revoke all on function public.resume_ai_runtime_prune_competition_state() from public;
revoke all on function public.resume_ai_runtime_delete_expired_session_start(text) from public;
revoke all on function public.resume_ai_runtime_reset_expired_session_transitions(text) from public;
revoke all on function public.resume_ai_runtime_delete_pending_transition(text, text) from public;
revoke all on function public.resume_ai_runtime_prune_model_gate() from public;
revoke all on function public.resume_ai_runtime_delete_model_waiter(uuid) from public;
revoke all on function public.resume_ai_runtime_delete_model_lease(uuid) from public;

-- Encrypted, expiring v6 decision state; raw user answers are never indexed.
create table if not exists competition_decision_states (
  state_key text primary key check (state_key ~ '^[0-9a-f]{64}$'),
  generation integer not null default 0 check (generation >= 0),
  ciphertext bytea not null check (octet_length(ciphertext) <= 1048576),
  iv bytea not null check (octet_length(iv) = 12),
  tag bytea not null check (octet_length(tag) = 16),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_competition_decision_states_expiry on competition_decision_states(expires_at);
revoke all on table competition_decision_states from public;
-- Provision the existing runtime role with SELECT, INSERT and UPDATE only.
-- The existing maintenance role performs: DELETE ... WHERE expires_at <= now().

-- Append-only budget evidence; no content, credentials, or model reasoning.
create table if not exists ai_spend_budgets (
  run_id text primary key,
  hard_limit_micros bigint not null check (hard_limit_micros > 0 and hard_limit_micros <= 300000000),
  created_at timestamptz not null default now()
);
create table if not exists ai_spend_ledger (
  id uuid primary key,
  run_id text not null references ai_spend_budgets(run_id),
  model text not null check (model = 'deepseek-flash'),
  effort text not null check (effort in ('max','high','low')),
  phase text not null default 'calibration' check (phase in ('calibration','formal','repair','performance','reserve')),
  operation text not null,
  price_version text not null,
  reserved_micros bigint not null check (reserved_micros >= 0),
  charged_micros bigint check (charged_micros >= 0),
  state text not null check (state in ('reserved','usage_estimated','conservative','cancelled')),
  input_tokens bigint, output_tokens bigint, cached_input_tokens bigint,
  created_at timestamptz not null default now(), settled_at timestamptz,
  check ((state = 'reserved' and charged_micros is null) or (state <> 'reserved' and charged_micros is not null))
);
create index if not exists idx_ai_spend_ledger_run on ai_spend_ledger(run_id);
-- Existing local calibration ledgers predate the phase column.
alter table ai_spend_ledger add column if not exists phase text not null default 'calibration' check (phase in ('calibration','formal','repair','performance','reserve'));
revoke all on ai_spend_budgets, ai_spend_ledger from public;
-- Explicit administrator-controlled binding. Never infer or create a main run here.
create table if not exists ai_spend_authority (
  singleton boolean primary key default true check (singleton),
  run_id text not null references ai_spend_budgets(run_id),
  created_at timestamptz not null default now()
);
revoke all on ai_spend_authority from public;
-- Runtime gets SELECT only via the explicit deployment privilege allowlist.
-- Admin must insert exactly the existing authorized main run after reviewing old spend.

-- Explicit finite public-development grants. Historical singleton authority,
-- budgets and reservations remain intact; only an administrator can issue/close.
create table if not exists ai_spend_development_batches (
  run_id text primary key references ai_spend_budgets(run_id),
  main_run_id text not null references ai_spend_budgets(run_id),
  call_limit integer not null check (call_limit > 0),
  state text not null default 'active' check (state in ('active','closed')),
  provider_balance_micros bigint not null check (provider_balance_micros > 0),
  protected_prior_micros bigint not null check (protected_prior_micros >= 0),
  funding_limit_micros bigint not null check (funding_limit_micros > 0),
  baseline_reservation_ids uuid[] not null,
  authorization_note text not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (run_id <> main_run_id),
  check (funding_limit_micros <= provider_balance_micros - protected_prior_micros),
  check ((state='active' and closed_at is null) or (state='closed' and closed_at is not null))
);
create unique index if not exists idx_ai_spend_one_active_development_batch
  on ai_spend_development_batches ((true)) where state='active';
revoke all on ai_spend_development_batches from public;

-- Historical grants keep max. Only an administrator may issue the evidence-
-- bound one-step high grant after a real full max group fails its 4/5 gate.
do $$ begin
if not exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_development_effort_evidence_check') then
alter table ai_spend_development_batches
  add column if not exists authorized_effort text not null default 'max'
    check (authorized_effort in ('max','high')),
  add column if not exists effort_condition_sha256 text,
  add column if not exists effort_condition jsonb;
alter table ai_spend_development_batches
  add constraint ai_spend_development_effort_evidence_check check ((
    (authorized_effort='max' and effort_condition_sha256 is null and effort_condition is null)
    or (authorized_effort='high' and effort_condition_sha256 ~ '^[a-f0-9]{64}$'
      and effort_condition is not null
      and effort_condition->>'schemaVersion'='saitu.max-failure-budget-condition.v1'
      and effort_condition->>'initialEffort'='max'
      and effort_condition->>'nextPermittedEffort'='high'
      and effort_condition->>'sourceRunId'<>run_id
      and effort_condition->>'freshPgRowsVerified'='true')
  ) is true);
end if;
end $$;

-- Durable v7 recommendation work. Personal input and results remain encrypted.
create table if not exists competition_decision_runs (
  run_id uuid primary key,
  state_key text not null references competition_decision_states(state_key),
  submission_key text not null unique check (submission_key ~ '^[0-9a-f]{64}$'),
  implementation_version text not null,
  status text not null check (status in ('queued','ranking','list_ready','explaining','partial_ready','ready','failed','superseded','expired')),
  result_version integer not null default 0 check (result_version >= 0),
  ciphertext bytea not null check (octet_length(ciphertext) <= 8388608),
  iv bytea not null check (octet_length(iv) = 12),
  tag bytea not null check (octet_length(tag) = 16),
  submitted_at timestamptz not null,
  list_deadline_at timestamptz not null,
  detail_deadline_at timestamptz not null,
  expires_at timestamptz not null,
  lease_owner text,
  lease_fence bigint not null default 0,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  check (list_deadline_at > submitted_at and detail_deadline_at >= list_deadline_at and expires_at > detail_deadline_at)
);
create index if not exists idx_decision_runs_claim on competition_decision_runs(implementation_version,status,submitted_at);
create index if not exists idx_decision_runs_expiry on competition_decision_runs(expires_at);
create index if not exists idx_decision_runs_state on competition_decision_runs(state_key);
create table if not exists competition_decision_calls (
  call_id uuid primary key,
  run_id uuid not null references competition_decision_runs(run_id),
  call_key text not null,
  prompt_sha256 text not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  reservation_id uuid unique references ai_spend_ledger(id),
  state text not null check (state in ('prepared','reserved','dispatch_intent','response_received','unknown','completed')),
  ciphertext bytea check (octet_length(ciphertext) <= 1048576),
  iv bytea check (octet_length(iv) = 12),
  tag bytea check (octet_length(tag) = 16),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  response_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(run_id,call_key)
);
revoke all on competition_decision_runs, competition_decision_calls from public;

-- Input snapshots and replies survive eviction of the HTTP idempotency cache.
-- The session expiry and parent run determine retention; all content is encrypted.
create table if not exists competition_decision_chat_requests (
  run_id uuid not null references competition_decision_runs(run_id),
  request_id text not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  ciphertext bytea not null check (octet_length(ciphertext) <= 8388608),
  iv bytea not null check (octet_length(iv) = 12),
  tag bytea not null check (octet_length(tag) = 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(run_id,request_id)
);
revoke all on competition_decision_chat_requests from public;

-- Version the explicit user-approved v7 grant without rewriting historical
-- max/high failure evidence or weakening the shared real-balance checkpoint.
alter table ai_spend_development_batches
  add column if not exists grant_version text not null default 'legacy',
  add column if not exists authorized_phase text not null default 'calibration',
  add column if not exists policy_sha256 text;
do $$ begin
if not exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_v7_phase_policy_check')
  or not exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_development_effort_evidence_check') then
  alter table ai_spend_development_batches drop constraint if exists ai_spend_development_effort_evidence_check;
  alter table ai_spend_development_batches drop constraint if exists ai_spend_v7_phase_policy_check;
  -- Retain the old constraint name so replaying the earlier idempotent migration
  -- does not reinstall its narrower predicate over explicitly granted v7 rows.
  alter table ai_spend_development_batches add constraint ai_spend_development_effort_evidence_check check ((
    (grant_version='legacy' and authorized_phase='calibration' and policy_sha256 is null and (
      (authorized_effort='max' and effort_condition_sha256 is null and effort_condition is null)
      or (authorized_effort='high' and effort_condition_sha256 ~ '^[a-f0-9]{64}$'
        and effort_condition is not null and effort_condition->>'schemaVersion'='saitu.max-failure-budget-condition.v1'
        and effort_condition->>'initialEffort'='max' and effort_condition->>'nextPermittedEffort'='high'
        and effort_condition->>'sourceRunId'<>run_id and effort_condition->>'freshPgRowsVerified'='true')))
    or (grant_version='saitu.v7' and authorized_phase in ('calibration','formal','repair','performance','reserve')
      and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='high'
      and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and effort_condition is not null
      and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7'
      and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='high'
      and effort_condition->>'phase'=authorized_phase and effort_condition->>'policySha256'=policy_sha256
      and effort_condition->>'authorization'='user-approved-20261109-continuation'
      and effort_condition->>'freshPgRowsVerified'='true')
  ) is true);
  alter table ai_spend_development_batches add constraint ai_spend_v7_phase_policy_check check (grant_version in ('legacy','saitu.v7'));
end if;
end $$;

-- New stage-bound grants are explicit administrator authorizations. Historical
-- legacy max/high and v7 high grants keep their original evidence predicates.
alter table ai_spend_development_batches
  add column if not exists effort_policy jsonb,
  add column if not exists effort_policy_sha256 text;

-- New dispatches retain their resolved policy next to actual operation/effort.
-- Old rows remain NULL: historical receipts are not retrospectively relabeled.
alter table ai_spend_ledger
  add column if not exists effort_policy_sha256 text
    check (effort_policy_sha256 ~ '^[a-f0-9]{64}$');
alter table competition_decision_calls
  add column if not exists operation text,
  add column if not exists dispatch_owner text,
  add column if not exists dispatch_fence bigint,
  add column if not exists thinking text check (thinking='enabled'),
  add column if not exists reasoning_effort text check (reasoning_effort in ('max','high','low')),
  add column if not exists effort_policy_sha256 text
    check (effort_policy_sha256 ~ '^[a-f0-9]{64}$');

alter table ai_spend_development_batches
  drop constraint if exists ai_spend_development_batches_authorized_effort_check;
alter table ai_spend_development_batches
  add constraint ai_spend_development_batches_authorized_effort_check
  check (authorized_effort in ('max','high','stage'));

-- Keep both old constraint names: replaying the prior migrations must not
-- reinstall their narrower predicates over explicitly authorized new rows.
-- Explicit additional user authority. Historical grants/budgets/ledger values are not updated.
alter table ai_spend_budgets add column if not exists execution_mode text;
alter table ai_spend_budgets alter column hard_limit_micros drop not null;
alter table ai_spend_budgets drop constraint if exists ai_spend_budget_execution_mode_check;
alter table ai_spend_budgets add constraint ai_spend_budget_execution_mode_check check ((
  (execution_mode is null and hard_limit_micros is not null)
  or (execution_mode='user-unbounded' and hard_limit_micros is null)
) is true);
alter table ai_spend_development_batches add column if not exists execution_mode text;
alter table ai_spend_development_batches alter column call_limit drop not null;
alter table ai_spend_development_batches drop constraint if exists ai_spend_batch_execution_mode_check;
alter table ai_spend_development_batches add constraint ai_spend_batch_execution_mode_check check ((
  (execution_mode is null and call_limit is not null and grant_version<>'saitu.v7.top5.user-unbounded.v1')
  or (execution_mode='user-unbounded' and call_limit is null and grant_version='saitu.v7.top5.user-unbounded.v1')
) is true);
alter table competition_decision_runs add column if not exists execution_mode text
  check (execution_mode in ('finite','user-unbounded'));
alter table ai_spend_development_batches
  drop constraint if exists ai_spend_development_effort_evidence_check,
  drop constraint if exists ai_spend_v7_phase_policy_check;
alter table ai_spend_development_batches
  add constraint ai_spend_development_effort_evidence_check check ((
    (grant_version='legacy' and authorized_phase='calibration' and policy_sha256 is null
      and effort_policy is null and effort_policy_sha256 is null and (
      (authorized_effort='max' and effort_condition_sha256 is null and effort_condition is null)
      or (authorized_effort='high' and effort_condition_sha256 ~ '^[a-f0-9]{64}$'
        and effort_condition is not null and effort_condition->>'schemaVersion'='saitu.max-failure-budget-condition.v1'
        and effort_condition->>'initialEffort'='max' and effort_condition->>'nextPermittedEffort'='high'
        and effort_condition->>'sourceRunId'<>run_id and effort_condition->>'freshPgRowsVerified'='true')))
    or (grant_version='saitu.v7' and authorized_phase in ('calibration','formal','repair','performance','reserve')
      and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='high'
      and effort_policy is null and effort_policy_sha256 is null
      and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and effort_condition is not null
      and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7'
      and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='high'
      and effort_condition->>'phase'=authorized_phase and effort_condition->>'policySha256'=policy_sha256
      and effort_condition->>'authorization'='user-approved-20261109-continuation'
      and effort_condition->>'freshPgRowsVerified'='true')
    or (grant_version='saitu.v7.effort.v1' and authorized_phase in ('calibration','formal','repair','performance','reserve')
      and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='stage'
      and effort_policy_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_policy)='object'
      and effort_policy - array['version','rank','explain','review']='{}'::jsonb
      and effort_policy->>'version'='saitu.effort-policy.v1'
      and effort_policy->>'rank' in ('high','low')
      and effort_policy->>'explain' in ('high','low')
      and effort_policy->>'review' in ('high','low')
      and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and effort_condition is not null
      and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7.effort.v1'
      and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='stage'
      and effort_condition->>'mainRunId'=main_run_id
      and effort_condition->>'phase'=authorized_phase and effort_condition->>'policySha256'=policy_sha256
      and effort_condition->'effortPolicy'=effort_policy
      and effort_condition->>'effortPolicySha256'=effort_policy_sha256
      and effort_condition->>'authorization'='user-approved-20261109-effort-exploration'
      and effort_condition->>'freshPgRowsVerified'='true')

    or (grant_version='saitu.v7.top5.v1' and run_id ~ ('^saitu-v7-top5-20261109-' || authorized_phase || '-[0-9]{2}$')
      and authorized_phase in ('calibration','formal','repair','performance','reserve')
      and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='stage'
      and effort_policy_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_policy)='object'
      and effort_policy = '{"version":"saitu.effort-policy.v1","rank":"low","explain":"low","review":"low"}'::jsonb
      and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_condition)='object'
      and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7.top5.v1'
      and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='stage'
      and effort_condition->>'mainRunId'=main_run_id
      and effort_condition->>'phase'=authorized_phase and effort_condition->>'policySha256'=policy_sha256
      and effort_condition->'effortPolicy'=effort_policy
      and effort_condition->>'effortPolicySha256'=effort_policy_sha256
      and effort_condition->>'sourcePolicy'='docs/v7/top5-continuation-contract-20261109.md'
      and effort_condition->>'policyVersion'='saitu.policy.2026-11-09.v7.top5'
      and effort_condition->>'implementationVersion'='saitu.async.2026-11-09.v7.3.top5'
      and effort_condition->>'authorization'='user-approved-20261109-top5-continuation'
      and effort_condition->>'priorLedgerSha256' ~ '^[a-f0-9]{64}$'
      and effort_condition->>'freshPgRowsVerified'='true')
    or (grant_version='saitu.v7.top5.user-unbounded.v1' and execution_mode='user-unbounded' and call_limit is null and run_id ~ ('^saitu-v7-top5-unbounded-20261109-' || authorized_phase || '-[0-9]{2}$')
      and authorized_phase in ('calibration','formal','repair','performance','reserve')
      and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='stage'
      and effort_policy_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_policy)='object'
      and effort_policy = '{"version":"saitu.effort-policy.v1","rank":"low","explain":"low","review":"low"}'::jsonb
      and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_condition)='object'
      and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1'
      and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='stage'
      and effort_condition->>'mainRunId'=main_run_id
      and effort_condition->>'phase'=authorized_phase and effort_condition->>'policySha256'=policy_sha256
      and effort_condition->'effortPolicy'=effort_policy
      and effort_condition->>'effortPolicySha256'=effort_policy_sha256
      and effort_condition->>'sourcePolicy'='docs/v7/top5-unbounded-execution-contract-20261109.md'
      and effort_condition->>'policyVersion'='saitu.policy.2026-11-09.v7.top5'
      and effort_condition->>'implementationVersion'='saitu.async.2026-11-09.v7.3.top5'
      and effort_condition->>'authorization'='user-approved-20261109-top5-unbounded-execution'
      and effort_condition->>'priorLedgerSha256' ~ '^[a-f0-9]{64}$'
      and effort_condition->>'executionMode'='user-unbounded'
      and effort_condition->'executionLimits'='{"modelConcurrencyLimit":null,"totalCallLimit":null,"totalCostLimitMicros":null}'::jsonb
      and effort_condition->>'freshPgRowsVerified'='true')
  ) is true),
  add constraint ai_spend_v7_phase_policy_check
    check (grant_version in ('legacy','saitu.v7','saitu.v7.effort.v1','saitu.v7.top5.v1','saitu.v7.top5.user-unbounded.v1'));

alter table ai_spend_development_batches drop constraint if exists ai_spend_top5_grant_check;
alter table ai_spend_development_batches add constraint ai_spend_top5_grant_check
  check (grant_version in ('legacy','saitu.v7','saitu.v7.effort.v1','saitu.v7.top5.v1','saitu.v7.top5.user-unbounded.v1'));
