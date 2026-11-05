-- Content-free global AI model call budget. Safe to apply repeatedly.
create table if not exists ai_model_daily_usage (
  usage_day date not null,
  bucket text not null,
  call_count integer not null check (call_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (usage_day, bucket)
);

revoke all on table ai_model_daily_usage from public;
