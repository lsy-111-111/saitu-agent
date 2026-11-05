-- Keep analytics writes behind the server route. Supabase anon credentials are
-- public by design and must not bypass the route's validation or quotas.
drop policy if exists "events_insert_sanitized" on public.events;
revoke insert on public.events from public, anon, authenticated;
grant usage on schema public to service_role;
grant insert on public.events to service_role;

-- Add the constraints without holding a long validation lock, then validate
-- them explicitly. A deployment must stop on incompatible historical rows
-- instead of silently leaving a permanently unvalidated security boundary.
do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_event_name_allowed'
  ) then
    alter table public.events
      add constraint events_event_name_allowed check (
        event_name in (
          'page_view_home',
          'cta_click',
          'competition_detail_open',
          'competition_source_click',
          'competition_resource_open',
          'competition_team_open',
          'competition_recommend_started',
          'competition_recommend_completed',
          'competition_recommend_failed'
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_payload_object'
  ) then
    alter table public.events
      add constraint events_payload_object
      check (jsonb_typeof(payload) = 'object') not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_payload_size'
  ) then
    alter table public.events
      add constraint events_payload_size
      check (octet_length(payload::text) <= 8192) not valid;
  end if;
end
$migration$;

alter table public.events validate constraint events_event_name_allowed;
alter table public.events validate constraint events_payload_object;
alter table public.events validate constraint events_payload_size;
