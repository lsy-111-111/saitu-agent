-- Input snapshots and replies survive eviction of the HTTP idempotency cache.
-- The session expiry and parent run determine retention; all content is encrypted.
create table if not exists competition_decision_chat_requests (
  run_id uuid not null references competition_decision_runs(run_id),
  request_id text not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  ciphertext bytea not null check (octet_length(ciphertext) <= 8388608),
  iv bytea not null check (octet_length(iv) = 12),
  tag bytea not null check (octet_length(tag) = 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(run_id,request_id)
);
revoke all on competition_decision_chat_requests from public;
