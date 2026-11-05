\set ON_ERROR_STOP on

-- Run with the application's DATABASE_URL. The transaction verifies ownership,
-- atomic upsert behavior and the hard ceiling without leaving a usage row behind.
begin;

delete from ai_model_daily_usage
where usage_day = date '1970-01-01' and bucket = 'deployment_selfcheck';

insert into ai_model_daily_usage (usage_day, bucket, call_count, updated_at)
values (date '1970-01-01', 'deployment_selfcheck', 1, now())
on conflict (usage_day, bucket) do update
  set call_count = ai_model_daily_usage.call_count + 1,
      updated_at = now()
where ai_model_daily_usage.call_count < 2;

insert into ai_model_daily_usage (usage_day, bucket, call_count, updated_at)
values (date '1970-01-01', 'deployment_selfcheck', 1, now())
on conflict (usage_day, bucket) do update
  set call_count = ai_model_daily_usage.call_count + 1,
      updated_at = now()
where ai_model_daily_usage.call_count < 2;

-- A third reservation at the same ceiling must not increment the row.
insert into ai_model_daily_usage (usage_day, bucket, call_count, updated_at)
values (date '1970-01-01', 'deployment_selfcheck', 1, now())
on conflict (usage_day, bucket) do update
  set call_count = ai_model_daily_usage.call_count + 1,
      updated_at = now()
where ai_model_daily_usage.call_count < 2;

do $$
declare
  observed_count integer;
begin
  select call_count into observed_count
  from ai_model_daily_usage
  where usage_day = date '1970-01-01' and bucket = 'deployment_selfcheck';

  if observed_count is distinct from 2 then
    raise exception 'ai_model_daily_usage self-check failed: expected 2, got %', observed_count;
  end if;
end
$$;

rollback;
