-- Narrow deletion capabilities for the application runtime. These functions
-- are owned by the migration owner and are the only DELETE entry points that
-- the non-owner runtime role may execute. Safe to apply repeatedly.

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
     select candidate.ctid
       from public.competition_idempotency candidate
      where candidate.expires_at <= pg_catalog.now()
      order by candidate.expires_at
      limit 500
      for update skip locked
   );
  get diagnostics affected = row_count;
  total_affected := total_affected + affected;

  delete from public.competition_session_starts target
   where target.ctid in (
     select candidate.ctid
       from public.competition_session_starts candidate
      where candidate.expires_at <= pg_catalog.now()
      order by candidate.expires_at
      limit 500
      for update skip locked
   );
  get diagnostics affected = row_count;
  total_affected := total_affected + affected;

  -- Deleting an expired session deliberately cascades to its transitions.
  delete from public.competition_sessions target
   where target.ctid in (
     select candidate.ctid
       from public.competition_sessions candidate
      where candidate.expires_at <= pg_catalog.now()
      order by candidate.expires_at
      limit 500
      for update skip locked
   );
  get diagnostics affected = row_count;
  total_affected := total_affected + affected;

  delete from public.competition_rate_limit_counters target
   where target.ctid in (
     select candidate.ctid
       from public.competition_rate_limit_counters candidate
      where candidate.reset_at <= pg_catalog.now()
      order by candidate.reset_at
      limit 500
      for update skip locked
   );
  get diagnostics affected = row_count;
  return total_affected + affected;
end
$function$;

create or replace function public.resume_ai_runtime_delete_expired_session_start(
  p_start_key text
)
returns boolean
language plpgsql
strict
volatile
parallel unsafe
security definer
set search_path = pg_catalog
as $function$
declare
  affected integer;
begin
  if p_start_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid hashed session-start key' using errcode = '22023';
  end if;
  delete from public.competition_session_starts
   where start_key = p_start_key
     and expires_at <= pg_catalog.now();
  get diagnostics affected = row_count;
  return affected = 1;
end
$function$;

create or replace function public.resume_ai_runtime_reset_expired_session_transitions(
  p_session_key text
)
returns integer
language plpgsql
strict
volatile
parallel unsafe
security definer
set search_path = pg_catalog
as $function$
declare
  affected integer;
begin
  if p_session_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid hashed session key' using errcode = '22023';
  end if;
  delete from public.competition_session_transitions transition
   where transition.session_key = p_session_key
     and exists (
       select 1
         from public.competition_sessions session
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
returns boolean
language plpgsql
strict
volatile
parallel unsafe
security definer
set search_path = pg_catalog
as $function$
declare
  affected integer;
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
  delete from public.ai_model_call_leases
   where expires_at <= pg_catalog.now();
  get diagnostics affected = row_count;
  total_affected := total_affected + affected;

  delete from public.ai_model_call_waiters
   where expires_at <= pg_catalog.now();
  get diagnostics affected = row_count;
  return total_affected + affected;
end
$function$;

create or replace function public.resume_ai_runtime_delete_model_waiter(
  p_waiter_id uuid
)
returns boolean
language plpgsql
strict
volatile
parallel unsafe
security definer
set search_path = pg_catalog
as $function$
declare
  affected integer;
begin
  delete from public.ai_model_call_waiters where waiter_id = p_waiter_id;
  get diagnostics affected = row_count;
  return affected = 1;
end
$function$;

create or replace function public.resume_ai_runtime_delete_model_lease(
  p_lease_id uuid
)
returns boolean
language plpgsql
strict
volatile
parallel unsafe
security definer
set search_path = pg_catalog
as $function$
declare
  affected integer;
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
