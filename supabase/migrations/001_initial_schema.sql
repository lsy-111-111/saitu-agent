create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  target_job text,
  template_id text not null,
  diagnosis_score integer,
  base_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resume_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  resume_id uuid not null references public.resumes (id) on delete cascade,
  name text not null,
  target_job text,
  template_id text not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.diagnosis_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  resume_id uuid not null references public.resumes (id) on delete cascade,
  resume_version_id uuid references public.resume_versions (id) on delete set null,
  scores jsonb not null,
  issues jsonb not null default '[]'::jsonb,
  suggestions jsonb not null default '[]'::jsonb,
  prompt_version text,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.export_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  resume_id uuid not null references public.resumes (id) on delete cascade,
  resume_version_id uuid references public.resume_versions (id) on delete set null,
  template_id text not null,
  status text not null check (status in ('success', 'error')),
  file_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint events_event_name_allowed check (
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
  ),
  constraint events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint events_payload_size check (octet_length(payload::text) <= 8192),
  constraint events_payload_contract check (
    (not (payload ? 'source') or (
      jsonb_typeof(payload -> 'source') = 'string'
      and payload ->> 'source' in ('direct', 'referral')
    ))
    and (not (payload ? 'device') or (
      jsonb_typeof(payload -> 'device') = 'string'
      and payload ->> 'device' in ('desktop', 'mobile', 'server')
    ))
    and (not (payload ? 'path') or (
      jsonb_typeof(payload -> 'path') = 'string'
      and payload ->> 'path' in (
        '/', '/about', '/competitions', '/competitions/recommend',
        '/competitions/saved', '/privacy', '/resources', '/teams', '/terms'
      )
    ))
    and (not (payload ? 'position') or (
      jsonb_typeof(payload -> 'position') = 'string'
      and payload ->> 'position' in (
        '/', '/about', '/competitions', '/competitions/recommend',
        '/competitions/saved', '/privacy', '/resources', '/teams', '/terms'
      )
    ))
    and (not (payload ? 'ctaName') or (
      jsonb_typeof(payload -> 'ctaName') = 'string'
      and payload ->> 'ctaName' in (
        'about', 'competition_assistant', 'competition_directory', 'resources',
        'retry_match', 'return_results', 'start_match', 'teams'
      )
    ))
    and (not (payload ? 'competitionId') or (
      jsonb_typeof(payload -> 'competitionId') = 'string'
      and payload ->> 'competitionId' ~ '^([a-z0-9]+)(-[a-z0-9]+)*$'
    ))
    and (not (payload ? 'competitionIds') or (
      jsonb_typeof(payload -> 'competitionIds') = 'string'
      and payload ->> 'competitionIds' ~ '^([a-z0-9]+)(-[a-z0-9]+)*(,([a-z0-9]+)(-[a-z0-9]+)*){0,9}$'
    ))
    and (not (payload ? 'resultCount') or (
      jsonb_typeof(payload -> 'resultCount') = 'number'
      and payload ->> 'resultCount' ~ '^([1-9]|10)$'
    ))
    and (not (payload ? 'fallbackUsed') or jsonb_typeof(payload -> 'fallbackUsed') = 'boolean')
    and (not (payload ? 'fallbackMode') or (
      jsonb_typeof(payload -> 'fallbackMode') = 'string'
      and payload ->> 'fallbackMode' in ('none', 'partial', 'full')
    ))
    and (not (payload ? 'fallbackReason') or (
      jsonb_typeof(payload -> 'fallbackReason') = 'string'
      and payload ->> 'fallbackReason' in (
        'missing_api_key', 'mock_mode', 'mock_not_allowed', 'provider_not_allowed',
        'authentication_error', 'insufficient_balance', 'invalid_request', 'rate_limited',
        'upstream_server_error', 'api_error', 'response_too_large', 'invalid_json',
        'invalid_output', 'empty_content', 'truncated', 'network_error', 'timeout',
        'capacity_exhausted', 'daily_budget_exhausted', 'budget_store_unavailable'
      )
    ))
    and (not (payload ? 'provider') or (
      jsonb_typeof(payload -> 'provider') = 'string'
      and payload ->> 'provider' in ('deepseek', 'mock', 'openai-compatible', 'server')
    ))
    and (not (payload ? 'failureReason') or (
      jsonb_typeof(payload -> 'failureReason') = 'string'
      and payload ->> 'failureReason' in (
        'rate_limited', 'consent_required', 'unsafe_request', 'session_recovery',
        'service_unavailable', 'invalid_response', 'network_error', 'request_failed'
      )
    ))
    and case event_name
      when 'page_view_home' then
        payload - array['source', 'device', 'path'] = '{}'::jsonb
        and (not (payload ? 'path') or payload ->> 'path' = '/')
      when 'cta_click' then
        payload - array['source', 'device', 'path', 'ctaName', 'position'] = '{}'::jsonb
        and payload ?& array['ctaName', 'position']
        and (not (payload ? 'path') or payload ->> 'path' = payload ->> 'position')
      when 'competition_detail_open' then
        payload - array['source', 'device', 'path', 'competitionId'] = '{}'::jsonb
        and payload ? 'competitionId'
      when 'competition_source_click' then
        payload - array['source', 'device', 'path', 'competitionId'] = '{}'::jsonb
        and payload ? 'competitionId'
      when 'competition_resource_open' then
        payload - array['source', 'device', 'path', 'competitionId'] = '{}'::jsonb
        and payload ? 'competitionId'
      when 'competition_team_open' then
        payload - array['source', 'device', 'path', 'competitionId'] = '{}'::jsonb
        and payload ? 'competitionId'
      when 'competition_recommend_started' then
        payload - array['source', 'device', 'path'] = '{}'::jsonb
        and (not (payload ? 'path') or payload ->> 'path' = '/competitions/recommend')
      when 'competition_recommend_completed' then
        payload - array[
          'source', 'device', 'path', 'resultCount', 'fallbackUsed', 'fallbackMode',
          'fallbackReason', 'provider', 'competitionIds'
        ] = '{}'::jsonb
        and payload ?& array['resultCount', 'fallbackUsed', 'fallbackMode', 'provider', 'competitionIds']
        and (not (payload ? 'path') or payload ->> 'path' = '/competitions/recommend')
        and case
          when payload ->> 'resultCount' ~ '^([1-9]|10)$'
            and payload ->> 'competitionIds' ~ '^([a-z0-9]+)(-[a-z0-9]+)*(,([a-z0-9]+)(-[a-z0-9]+)*){0,9}$'
          then array_length(string_to_array(payload ->> 'competitionIds', ','), 1)
            = (payload ->> 'resultCount')::integer
          else false
        end
        and case payload ->> 'fallbackUsed'
          when 'true' then payload ->> 'fallbackMode' in ('partial', 'full') and payload ? 'fallbackReason'
          when 'false' then payload ->> 'fallbackMode' = 'none' and not (payload ? 'fallbackReason')
          else false
        end
      when 'competition_recommend_failed' then
        payload - array['source', 'device', 'path', 'failureReason'] = '{}'::jsonb
        and payload ? 'failureReason'
        and (not (payload ? 'path') or payload ->> 'path' = '/competitions/recommend')
      else false
    end
  ),
  constraint events_payload_no_sensitive_keys check (
    not (
      payload ?| array[
        'resumeText',
        'rawResume',
        'fullResume',
        'fullContact',
        'phone',
        'email',
        'errorStack',
        'stack'
      ]
    )
  ),
  constraint events_user_id_anonymous check (user_id is null)
);

create index if not exists resumes_user_id_updated_at_idx on public.resumes (user_id, updated_at desc);
create index if not exists resume_versions_user_resume_idx on public.resume_versions (user_id, resume_id, updated_at desc);
create index if not exists diagnosis_reports_user_resume_idx on public.diagnosis_reports (user_id, resume_id, created_at desc);
create index if not exists export_records_user_resume_idx on public.export_records (user_id, resume_id, created_at desc);
create index if not exists events_event_name_created_at_idx on public.events (event_name, created_at desc);
create index if not exists events_created_at_idx on public.events (created_at, id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists resumes_set_updated_at on public.resumes;
create trigger resumes_set_updated_at
before update on public.resumes
for each row execute function public.set_updated_at();

drop trigger if exists resume_versions_set_updated_at on public.resume_versions;
create trigger resume_versions_set_updated_at
before update on public.resume_versions
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.resumes enable row level security;
alter table public.resume_versions enable row level security;
alter table public.diagnosis_reports enable row level security;
alter table public.export_records enable row level security;
alter table public.events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "resumes_select_own" on public.resumes;
create policy "resumes_select_own"
on public.resumes for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "resumes_insert_own" on public.resumes;
create policy "resumes_insert_own"
on public.resumes for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "resumes_update_own" on public.resumes;
create policy "resumes_update_own"
on public.resumes for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "resumes_delete_own" on public.resumes;
create policy "resumes_delete_own"
on public.resumes for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "resume_versions_select_own" on public.resume_versions;
create policy "resume_versions_select_own"
on public.resume_versions for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "resume_versions_insert_own" on public.resume_versions;
create policy "resume_versions_insert_own"
on public.resume_versions for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.resumes
    where resumes.id = resume_versions.resume_id
      and resumes.user_id = auth.uid()
  )
);

drop policy if exists "resume_versions_update_own" on public.resume_versions;
create policy "resume_versions_update_own"
on public.resume_versions for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.resumes
    where resumes.id = resume_versions.resume_id
      and resumes.user_id = auth.uid()
  )
);

drop policy if exists "resume_versions_delete_own" on public.resume_versions;
create policy "resume_versions_delete_own"
on public.resume_versions for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "diagnosis_reports_select_own" on public.diagnosis_reports;
create policy "diagnosis_reports_select_own"
on public.diagnosis_reports for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "diagnosis_reports_insert_own" on public.diagnosis_reports;
create policy "diagnosis_reports_insert_own"
on public.diagnosis_reports for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.resumes
    where resumes.id = diagnosis_reports.resume_id
      and resumes.user_id = auth.uid()
  )
);

drop policy if exists "diagnosis_reports_delete_own" on public.diagnosis_reports;
create policy "diagnosis_reports_delete_own"
on public.diagnosis_reports for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "export_records_select_own" on public.export_records;
create policy "export_records_select_own"
on public.export_records for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "export_records_insert_own" on public.export_records;
create policy "export_records_insert_own"
on public.export_records for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.resumes
    where resumes.id = export_records.resume_id
      and resumes.user_id = auth.uid()
  )
);

drop policy if exists "export_records_delete_own" on public.export_records;
create policy "export_records_delete_own"
on public.export_records for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "events_insert_sanitized" on public.events;

drop policy if exists "events_select_own" on public.events;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.resumes to authenticated;
grant select, insert, update, delete on public.resume_versions to authenticated;
grant select, insert, delete on public.diagnosis_reports to authenticated;
grant select, insert, delete on public.export_records to authenticated;
revoke insert on public.events from public, anon, authenticated;
revoke select on public.events from public, anon, authenticated, service_role;
grant usage on schema public to service_role;
grant insert on public.events to service_role;
