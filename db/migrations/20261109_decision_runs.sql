-- Durable v7 recommendation work. Personal input and results remain encrypted.
create table if not exists competition_decision_runs (
  run_id uuid primary key,
  state_key text not null references competition_decision_states(state_key),
  submission_key text not null unique check (submission_key ~ '^[0-9a-f]{64}$'),
  implementation_version text not null,
  status text not null check (status in ('queued','ranking','list_ready','explaining','partial_ready','ready','failed','superseded','expired')),
  result_version integer not null default 0 check (result_version >= 0),
  ciphertext bytea not null check (octet_length(ciphertext) <= 8388608),
  iv bytea not null check (octet_length(iv) = 12),
  tag bytea not null check (octet_length(tag) = 16),
  submitted_at timestamptz not null,
  list_deadline_at timestamptz not null,
  detail_deadline_at timestamptz not null,
  expires_at timestamptz not null,
  lease_owner text,
  lease_fence bigint not null default 0,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  check (list_deadline_at > submitted_at and detail_deadline_at >= list_deadline_at and expires_at > detail_deadline_at)
);
create index if not exists idx_decision_runs_claim on competition_decision_runs(implementation_version,status,submitted_at);
create index if not exists idx_decision_runs_expiry on competition_decision_runs(expires_at);
create index if not exists idx_decision_runs_state on competition_decision_runs(state_key);
create table if not exists competition_decision_calls (
  call_id uuid primary key,
  run_id uuid not null references competition_decision_runs(run_id),
  call_key text not null,
  prompt_sha256 text not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  reservation_id uuid unique references ai_spend_ledger(id),
  state text not null check (state in ('prepared','reserved','dispatch_intent','response_received','unknown','completed')),
  ciphertext bytea check (octet_length(ciphertext) <= 1048576),
  iv bytea check (octet_length(iv) = 12),
  tag bytea check (octet_length(tag) = 16),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  response_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(run_id,call_key)
);
revoke all on competition_decision_runs, competition_decision_calls from public;
