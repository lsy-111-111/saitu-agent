-- Keep direct service-role writes inside the same compact analytics contract as
-- /api/track. Catalog membership remains an application check because the
-- public competition catalog is source-controlled rather than a database table.
do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_payload_contract'
  ) then
    alter table public.events
      add constraint events_payload_contract check (
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
      ) not valid;
  end if;
end
$migration$;

alter table public.events validate constraint events_payload_contract;
