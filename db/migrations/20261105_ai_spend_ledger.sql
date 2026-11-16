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
