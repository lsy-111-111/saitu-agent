-- Explicit administrator-controlled binding. Never infer or create a main run here.
create table if not exists ai_spend_authority (
  singleton boolean primary key default true check (singleton),
  run_id text not null references ai_spend_budgets(run_id),
  created_at timestamptz not null default now()
);
revoke all on ai_spend_authority from public;
-- Runtime gets SELECT only via the explicit deployment privilege allowlist.
-- Admin must insert exactly the existing authorized main run after reviewing old spend.
