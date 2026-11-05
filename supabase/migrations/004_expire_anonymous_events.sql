-- Analytics events are deliberately anonymous and become eligible for
-- deletion after 180 days.  pg_cron is required so a deployment cannot claim
-- automatic expiry while silently omitting the scheduler.
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated, service_role;

-- Remove any historical account linkage before enforcing the anonymous-only
-- invariant.  The application already writes NULL explicitly.
drop policy if exists "events_select_own" on public.events;
revoke select on public.events from public, anon, authenticated, service_role;
update public.events set user_id = null where user_id is not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_user_id_anonymous'
  ) then
    alter table public.events
      add constraint events_user_id_anonymous
      check (user_id is null) not valid;
  end if;
end
$migration$;

alter table public.events validate constraint events_user_id_anonymous;
create index if not exists events_created_at_idx on public.events (created_at, id);

-- Bound each execution so cleanup cannot monopolize the database after an
-- extended outage.  SKIP LOCKED keeps ingestion independent of each batch.
create or replace function private.purge_expired_analytics_events(
  p_batch_size integer default 500,
  p_max_batches integer default 20
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_batch integer := 0;
  v_deleted integer := 0;
  v_total integer := 0;
  v_cutoff timestamptz := clock_timestamp() - interval '180 days';
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 5000 then
    raise exception 'p_batch_size must be between 1 and 5000';
  end if;
  if p_max_batches is null or p_max_batches < 1 or p_max_batches > 100 then
    raise exception 'p_max_batches must be between 1 and 100';
  end if;

  loop
    exit when v_batch >= p_max_batches;

    with expired as (
      select event.id
      from public.events as event
      where event.created_at < v_cutoff
      order by event.created_at, event.id
      limit p_batch_size
      for update skip locked
    ), deleted as (
      delete from public.events as event
      using expired
      where event.id = expired.id
      returning 1
    )
    select count(*)::integer into v_deleted from deleted;

    v_total := v_total + v_deleted;
    v_batch := v_batch + 1;
    exit when v_deleted < p_batch_size;
  end loop;

  return v_total;
end
$function$;

revoke all on function private.purge_expired_analytics_events(integer, integer)
  from public, anon, authenticated, service_role;

-- pg_cron updates a named job in place, making this migration idempotent.
select cron.schedule(
  'resume-ai-events-retention',
  '17 3 * * *',
  $job$select private.purge_expired_analytics_events(500, 20);$job$
);
