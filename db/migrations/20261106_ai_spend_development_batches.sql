-- Explicit finite public-development grants. Historical singleton authority,
-- budgets and reservations remain intact; only an administrator can issue/close.
create table if not exists ai_spend_development_batches (
  run_id text primary key references ai_spend_budgets(run_id),
  main_run_id text not null references ai_spend_budgets(run_id),
  call_limit integer not null check (call_limit > 0),
  state text not null default 'active' check (state in ('active','closed')),
  provider_balance_micros bigint not null check (provider_balance_micros > 0),
  protected_prior_micros bigint not null check (protected_prior_micros >= 0),
  funding_limit_micros bigint not null check (funding_limit_micros > 0),
  baseline_reservation_ids uuid[] not null,
  authorization_note text not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (run_id <> main_run_id),
  check (funding_limit_micros <= provider_balance_micros - protected_prior_micros),
  check ((state='active' and closed_at is null) or (state='closed' and closed_at is not null))
);
create unique index if not exists idx_ai_spend_one_active_development_batch
  on ai_spend_development_batches ((true)) where state='active';
revoke all on ai_spend_development_batches from public;
