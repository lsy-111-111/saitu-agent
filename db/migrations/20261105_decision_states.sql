-- Encrypted, expiring v6 decision state; raw user answers are never indexed.
create table if not exists competition_decision_states (
  state_key text primary key check (state_key ~ '^[0-9a-f]{64}$'),
  generation integer not null default 0 check (generation >= 0),
  ciphertext bytea not null check (octet_length(ciphertext) <= 1048576),
  iv bytea not null check (octet_length(iv) = 12),
  tag bytea not null check (octet_length(tag) = 16),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_competition_decision_states_expiry on competition_decision_states(expires_at);
revoke all on table competition_decision_states from public;
-- Provision the existing runtime role with SELECT, INSERT and UPDATE only.
-- The existing maintenance role performs: DELETE ... WHERE expires_at <= now().
