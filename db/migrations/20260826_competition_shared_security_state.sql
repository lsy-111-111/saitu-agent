-- Shared, content-free security state for competition AI requests and model
-- capacity. Cached response bodies are encrypted with AES-256-GCM by the
-- application before insertion; plaintext answers and signed tokens must never
-- be stored in these tables. Safe to apply repeatedly.

create table if not exists competition_rate_limit_counters (
  bucket text not null check (bucket in ('session_start_minute', 'session_start_daily')),
  scope_key text not null check (scope_key ~ '^[0-9a-f]{64}$'),
  hit_count integer not null check (hit_count > 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (bucket, scope_key)
);

create index if not exists idx_competition_rate_limit_reset
  on competition_rate_limit_counters (reset_at);

create table if not exists competition_session_starts (
  start_key text primary key check (start_key ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_competition_session_starts_expiry
  on competition_session_starts (expires_at);

create table if not exists competition_sessions (
  session_key text primary key check (session_key ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_competition_sessions_expiry
  on competition_sessions (expires_at);

create table if not exists competition_session_transitions (
  session_key text not null references competition_sessions (session_key) on delete cascade,
  transition_key text not null check (transition_key ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('pending', 'committed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_key, transition_key)
);

create index if not exists idx_competition_session_transitions_expiry
  on competition_session_transitions (expires_at);

create table if not exists competition_idempotency (
  cache_key text primary key check (cache_key ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('pending', 'completed', 'retryable')),
  owner_token uuid,
  generation integer not null default 1 check (generation > 0),
  producer_retries smallint not null default 0 check (producer_retries between 0 and 2),
  retry_kind text check (retry_kind in ('no_store', 'failure')),
  expires_at timestamptz not null,
  lease_expires_at timestamptz,
  response_ciphertext bytea,
  response_iv bytea,
  response_tag bytea,
  response_bytes integer check (response_bytes between 0 and 1048604),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (state = 'pending' and owner_token is not null and lease_expires_at is not null and retry_kind is null)
    or
    (state <> 'pending' and owner_token is null and lease_expires_at is null)
  ),
  check (
    state = 'pending'
    or (state = 'completed' and retry_kind is null)
    or (state = 'retryable' and retry_kind is not null)
  ),
  check (
    (response_ciphertext is null and response_iv is null and response_tag is null and response_bytes is null)
    or
    (response_ciphertext is not null and response_iv is not null and octet_length(response_iv) = 12
      and response_tag is not null and octet_length(response_tag) = 16
      and octet_length(response_ciphertext) <= 1048576
      and response_bytes = octet_length(response_ciphertext) + 28)
  ),
  check (state <> 'completed' or response_ciphertext is not null)
);

create index if not exists idx_competition_idempotency_expiry
  on competition_idempotency (expires_at);
create index if not exists idx_competition_idempotency_lease
  on competition_idempotency (lease_expires_at) where state = 'pending';

create table if not exists ai_model_call_leases (
  lease_id uuid primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_model_call_leases_expiry
  on ai_model_call_leases (expires_at);

create table if not exists ai_model_call_waiters (
  waiter_id uuid primary key,
  expires_at timestamptz not null,
  enqueued_at timestamptz not null default now()
);

create index if not exists idx_ai_model_call_waiters_order
  on ai_model_call_waiters (enqueued_at, waiter_id);
create index if not exists idx_ai_model_call_waiters_expiry
  on ai_model_call_waiters (expires_at);

revoke all on table competition_rate_limit_counters from public;
revoke all on table competition_session_starts from public;
revoke all on table competition_sessions from public;
revoke all on table competition_session_transitions from public;
revoke all on table competition_idempotency from public;
revoke all on table ai_model_call_leases from public;
revoke all on table ai_model_call_waiters from public;
