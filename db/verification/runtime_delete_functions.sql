\set ON_ERROR_STOP on

-- Run as the controlled database owner after runtime-role reconciliation.
-- The verification is transactional and leaves no rows behind.
begin;

do $verification$
declare
  malformed_count integer;
  public_execute_count integer;
  owner_count integer;
begin
  with expected(function_name, argument_types) as (values
    ('resume_ai_runtime_prune_competition_state', ''),
    ('resume_ai_runtime_delete_expired_session_start', 'text'),
    ('resume_ai_runtime_reset_expired_session_transitions', 'text'),
    ('resume_ai_runtime_delete_pending_transition', 'text, text'),
    ('resume_ai_runtime_prune_model_gate', ''),
    ('resume_ai_runtime_delete_model_waiter', 'uuid'),
    ('resume_ai_runtime_delete_model_lease', 'uuid')
  )
  select count(*) into malformed_count
    from expected
   where not exists (
     select 1
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = expected.function_name
        and pg_get_function_identity_arguments(procedure.oid) = expected.argument_types
        and procedure.prosecdef
        and procedure.provolatile = 'v'
        and procedure.proparallel = 'u'
        and (procedure.pronargs = 0 or procedure.proisstrict)
        and procedure.proconfig = array['search_path=pg_catalog']::text[]
   );
  if malformed_count <> 0 then
    raise exception '% approved runtime deletion functions are missing or malformed',
      malformed_count;
  end if;

  select count(*) into malformed_count
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname like 'resume_ai_runtime_%'
     and (procedure.proname, pg_get_function_identity_arguments(procedure.oid)) not in (values
       ('resume_ai_runtime_prune_competition_state', ''),
       ('resume_ai_runtime_delete_expired_session_start', 'text'),
       ('resume_ai_runtime_reset_expired_session_transitions', 'text'),
       ('resume_ai_runtime_delete_pending_transition', 'text, text'),
       ('resume_ai_runtime_prune_model_gate', ''),
       ('resume_ai_runtime_delete_model_waiter', 'uuid'),
       ('resume_ai_runtime_delete_model_lease', 'uuid')
     );
  if malformed_count <> 0 then
    raise exception '% unapproved runtime database functions exist', malformed_count;
  end if;

  select count(*) into public_execute_count
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) privilege
   where namespace.nspname = 'public'
     and procedure.proname like 'resume_ai_runtime_%'
     and privilege.grantee = 0
     and privilege.privilege_type = 'EXECUTE';
  if public_execute_count <> 0 then
    raise exception 'PUBLIC retains EXECUTE on % runtime deletion functions',
      public_execute_count;
  end if;

  select count(distinct object_owner) into owner_count
    from (
      select relation.relowner as object_owner
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'public'
         and relation.relname in (
           'ai_model_daily_usage', 'competition_rate_limit_counters',
           'competition_session_starts', 'competition_sessions',
           'competition_session_transitions', 'competition_idempotency',
           'ai_model_call_leases', 'ai_model_call_waiters'
         )
      union all
      select procedure.proowner
        from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.proname like 'resume_ai_runtime_%'
    ) controlled_objects;
  if owner_count <> 1 then
    raise exception 'security-state tables and deletion functions must share one owner';
  end if;
end
$verification$;

insert into competition_session_starts (start_key, expires_at, created_at) values
  (repeat('1', 64), now() - interval '1 second', now()),
  (repeat('2', 64), now() + interval '30 minutes', now());

do $verification$
begin
  if not resume_ai_runtime_delete_expired_session_start(repeat('1', 64)) then
    raise exception 'expired session-start row was not deleted';
  end if;
  if resume_ai_runtime_delete_expired_session_start(repeat('2', 64)) then
    raise exception 'unexpired session-start row was deleted';
  end if;
  begin
    perform resume_ai_runtime_delete_expired_session_start('raw-key');
    raise exception 'malformed session-start key was accepted';
  exception when invalid_parameter_value then
    null;
  end;
end
$verification$;

insert into competition_sessions (session_key, expires_at, created_at, updated_at) values
  (repeat('3', 64), now() - interval '1 second', now(), now()),
  (repeat('4', 64), now() + interval '30 minutes', now(), now());
insert into competition_session_transitions
  (session_key, transition_key, state, expires_at, created_at, updated_at) values
  (repeat('3', 64), repeat('5', 64), 'committed', now() + interval '30 minutes', now(), now()),
  (repeat('4', 64), repeat('6', 64), 'pending', now() + interval '30 minutes', now(), now()),
  (repeat('4', 64), repeat('7', 64), 'committed', now() + interval '30 minutes', now(), now());

do $verification$
begin
  if resume_ai_runtime_reset_expired_session_transitions(repeat('3', 64)) <> 1 then
    raise exception 'expired session transitions were not reset';
  end if;
  if resume_ai_runtime_reset_expired_session_transitions(repeat('4', 64)) <> 0 then
    raise exception 'active session transitions were reset';
  end if;
  if not resume_ai_runtime_delete_pending_transition(repeat('4', 64), repeat('6', 64)) then
    raise exception 'the exact pending transition was not deleted';
  end if;
  if resume_ai_runtime_delete_pending_transition(repeat('4', 64), repeat('7', 64)) then
    raise exception 'a committed transition was deleted';
  end if;
end
$verification$;

insert into ai_model_call_leases (lease_id, expires_at, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000000001', now() - interval '1 second', now(), now()),
  ('00000000-0000-4000-8000-000000000002', now() + interval '3 minutes', now(), now());
insert into ai_model_call_waiters (waiter_id, expires_at, enqueued_at) values
  ('00000000-0000-4000-8000-000000000003', now() - interval '1 second', now()),
  ('00000000-0000-4000-8000-000000000004', now() + interval '15 seconds', now());

select resume_ai_runtime_prune_model_gate();

do $verification$
begin
  if exists (
    select 1 from ai_model_call_leases
     where lease_id = '00000000-0000-4000-8000-000000000001'
  ) or exists (
    select 1 from ai_model_call_waiters
     where waiter_id = '00000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'expired model gate state was not pruned';
  end if;
  if not resume_ai_runtime_delete_model_lease(
    '00000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'exact model lease was not released';
  end if;
  if not resume_ai_runtime_delete_model_waiter(
    '00000000-0000-4000-8000-000000000004'
  ) then
    raise exception 'exact model waiter was not removed';
  end if;
end
$verification$;

rollback;
