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
