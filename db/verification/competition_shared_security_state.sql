\set ON_ERROR_STOP on

-- Run with the application's DATABASE_URL after migrations. This self-check is
-- transactional and leaves no security-state rows behind.
begin;

do $$
declare
  required_table text;
  forbidden_column_count integer;
  public_grant_count integer;
  malformed_table_count integer;
  owner_count integer;
  missing_column_count integer;
  missing_constraint_count integer;
  missing_index_count integer;
begin
  foreach required_table in array array[
    'competition_rate_limit_counters',
    'competition_session_starts',
    'competition_sessions',
    'competition_session_transitions',
    'competition_idempotency',
    'ai_model_call_leases',
    'ai_model_call_waiters'
  ] loop
    if to_regclass(format('%I.%I', current_schema(), required_table)) is null then
      raise exception 'required shared security table is missing: %', required_table;
    end if;
  end loop;

  select count(*) into forbidden_column_count
  from information_schema.columns
  where table_schema = current_schema()
    and table_name in (
      'competition_rate_limit_counters', 'competition_session_starts',
      'competition_sessions', 'competition_session_transitions',
      'competition_idempotency', 'ai_model_call_leases', 'ai_model_call_waiters'
    )
    and column_name ~ '(answer|token|prompt|profile|payload|response_body|ip_address|session_id)';
  if forbidden_column_count <> 0 then
    raise exception 'shared security tables expose % forbidden content-bearing columns',
      forbidden_column_count;
  end if;

  -- information_schema.role_table_grants intentionally omits privileges granted
  -- through PUBLIC. Inspect the effective relation ACL directly (OID 0 is
  -- PUBLIC), including the default ACL when relacl is null.
  select count(*) into public_grant_count
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  cross join lateral aclexplode(
    coalesce(relation.relacl, acldefault('r', relation.relowner))
  ) privilege
  where namespace.nspname = current_schema()
    and relation.relname in (
      'competition_rate_limit_counters', 'competition_session_starts',
      'competition_sessions', 'competition_session_transitions',
      'competition_idempotency', 'ai_model_call_leases', 'ai_model_call_waiters'
    )
    and privilege.grantee = 0;
  if public_grant_count <> 0 then
    raise exception 'PUBLIC retains % grants on shared security tables', public_grant_count;
  end if;

  select count(*) into malformed_table_count
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = current_schema()
    and relation.relname in (
      'competition_rate_limit_counters', 'competition_session_starts',
      'competition_sessions', 'competition_session_transitions',
      'competition_idempotency', 'ai_model_call_leases', 'ai_model_call_waiters'
    )
    and (relation.relkind <> 'r' or relation.relpersistence <> 'p');
  if malformed_table_count <> 0 then
    raise exception '% shared security relations are not persistent ordinary tables',
      malformed_table_count;
  end if;

  select count(distinct relation.relowner) into owner_count
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = current_schema()
    and relation.relname in (
      'competition_rate_limit_counters', 'competition_session_starts',
      'competition_sessions', 'competition_session_transitions',
      'competition_idempotency', 'ai_model_call_leases', 'ai_model_call_waiters'
    );
  if owner_count <> 1 then
    raise exception 'shared security tables must have one controlled owner; found %', owner_count;
  end if;

  with expected(table_name, column_name, data_type, nullable) as (values
    ('competition_rate_limit_counters', 'scope_key', 'text', 'NO'),
    ('competition_rate_limit_counters', 'hit_count', 'integer', 'NO'),
    ('competition_session_starts', 'start_key', 'text', 'NO'),
    ('competition_sessions', 'session_key', 'text', 'NO'),
    ('competition_session_transitions', 'session_key', 'text', 'NO'),
    ('competition_session_transitions', 'transition_key', 'text', 'NO'),
    ('competition_session_transitions', 'state', 'text', 'NO'),
    ('competition_idempotency', 'cache_key', 'text', 'NO'),
    ('competition_idempotency', 'owner_token', 'uuid', 'YES'),
    ('competition_idempotency', 'generation', 'integer', 'NO'),
    ('competition_idempotency', 'producer_retries', 'smallint', 'NO'),
    ('competition_idempotency', 'response_ciphertext', 'bytea', 'YES'),
    ('competition_idempotency', 'response_iv', 'bytea', 'YES'),
    ('competition_idempotency', 'response_tag', 'bytea', 'YES'),
    ('ai_model_call_leases', 'lease_id', 'uuid', 'NO'),
    ('ai_model_call_waiters', 'waiter_id', 'uuid', 'NO')
  )
  select count(*) into missing_column_count
  from expected
  where not exists (
    select 1 from information_schema.columns column_info
    where column_info.table_schema = current_schema()
      and column_info.table_name = expected.table_name
      and column_info.column_name = expected.column_name
      and column_info.data_type = expected.data_type
      and column_info.is_nullable = expected.nullable
  );
  if missing_column_count <> 0 then
    raise exception '% required shared security columns have the wrong type or nullability',
      missing_column_count;
  end if;

  -- Primary keys on every state table and the cascading session foreign key
  -- are required for the row locks/UPSERTs used by the application.
  with required_primary_key(table_name, key_columns) as (values
    ('competition_rate_limit_counters', array['bucket', 'scope_key']::text[]),
    ('competition_session_starts', array['start_key']::text[]),
    ('competition_sessions', array['session_key']::text[]),
    ('competition_session_transitions', array['session_key', 'transition_key']::text[]),
    ('competition_idempotency', array['cache_key']::text[]),
    ('ai_model_call_leases', array['lease_id']::text[]),
    ('ai_model_call_waiters', array['waiter_id']::text[])
  )
  select count(*) into missing_constraint_count
  from required_primary_key expected
  where not exists (
    select 1
    from pg_constraint constraint_info
    join pg_class relation on relation.oid = constraint_info.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = current_schema()
      and relation.relname = expected.table_name
      and constraint_info.contype = 'p'
      and (select array_agg(attribute.attname::text order by key_position.ordinality)
           from unnest(constraint_info.conkey) with ordinality key_position(attnum, ordinality)
           join pg_attribute attribute
             on attribute.attrelid = relation.oid
            and attribute.attnum = key_position.attnum) = expected.key_columns
  );
  if missing_constraint_count <> 0 then
    raise exception '% shared security primary keys are missing or malformed',
      missing_constraint_count;
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_info
    join pg_class child on child.oid = constraint_info.conrelid
    join pg_class parent on parent.oid = constraint_info.confrelid
    join pg_namespace child_namespace on child_namespace.oid = child.relnamespace
    join pg_namespace parent_namespace on parent_namespace.oid = parent.relnamespace
    where child_namespace.nspname = current_schema()
      and parent_namespace.nspname = current_schema()
      and child.relname = 'competition_session_transitions'
      and parent.relname = 'competition_sessions'
      and constraint_info.contype = 'f'
      and constraint_info.confdeltype = 'c'
      and (select array_agg(attribute.attname::text order by key_position.ordinality)
           from unnest(constraint_info.conkey) with ordinality key_position(attnum, ordinality)
           join pg_attribute attribute
             on attribute.attrelid = child.oid
            and attribute.attnum = key_position.attnum) = array['session_key']::text[]
      and (select array_agg(attribute.attname::text order by key_position.ordinality)
           from unnest(constraint_info.confkey) with ordinality key_position(attnum, ordinality)
           join pg_attribute attribute
             on attribute.attrelid = parent.oid
            and attribute.attnum = key_position.attnum) = array['session_key']::text[]
  ) then
    raise exception 'competition session transition cascade foreign key is missing or malformed';
  end if;

  with expected(index_name, table_name, key_columns, partial) as (values
    ('idx_competition_rate_limit_reset', 'competition_rate_limit_counters',
      array['reset_at']::text[], false),
    ('idx_competition_session_starts_expiry', 'competition_session_starts',
      array['expires_at']::text[], false),
    ('idx_competition_sessions_expiry', 'competition_sessions',
      array['expires_at']::text[], false),
    ('idx_competition_session_transitions_expiry', 'competition_session_transitions',
      array['expires_at']::text[], false),
    ('idx_competition_idempotency_expiry', 'competition_idempotency',
      array['expires_at']::text[], false),
    ('idx_competition_idempotency_lease', 'competition_idempotency',
      array['lease_expires_at']::text[], true),
    ('idx_ai_model_call_leases_expiry', 'ai_model_call_leases',
      array['expires_at']::text[], false),
    ('idx_ai_model_call_waiters_order', 'ai_model_call_waiters',
      array['enqueued_at', 'waiter_id']::text[], false),
    ('idx_ai_model_call_waiters_expiry', 'ai_model_call_waiters',
      array['expires_at']::text[], false)
  )
  select count(*) into missing_index_count
  from expected
  where not exists (
    select 1
    from pg_class index_relation
    join pg_namespace namespace on namespace.oid = index_relation.relnamespace
    join pg_index index_info on index_info.indexrelid = index_relation.oid
    join pg_class table_relation on table_relation.oid = index_info.indrelid
    where namespace.nspname = current_schema()
      and index_relation.relname = expected.index_name
      and table_relation.relname = expected.table_name
      and index_info.indisvalid
      and index_info.indisready
      and (index_info.indpred is not null) = expected.partial
      and (select array_agg(attribute.attname::text order by key_position.ordinality)
           from unnest(index_info.indkey)
             with ordinality key_position(attnum, ordinality)
           join pg_attribute attribute
             on attribute.attrelid = table_relation.oid
            and attribute.attnum = key_position.attnum) = expected.key_columns
      and (not expected.partial or
        pg_get_expr(index_info.indpred, index_info.indrelid) ~ 'state.*pending')
  );
  if missing_index_count <> 0 then
    raise exception '% required shared security indexes are missing or malformed',
      missing_index_count;
  end if;
end
$$;

-- Negative control: prove this verification path can actually observe PUBLIC
-- privileges. A temporary probe is rolled back with the surrounding transaction.
create temporary table competition_security_public_acl_probe (id integer);
grant select on competition_security_public_acl_probe to public;
do $$
declare
  detected_public_grants integer;
begin
  select count(*) into detected_public_grants
  from pg_class relation
  cross join lateral aclexplode(
    coalesce(relation.relacl, acldefault('r', relation.relowner))
  ) privilege
  where relation.oid = 'pg_temp.competition_security_public_acl_probe'::regclass
    and privilege.grantee = 0
    and privilege.privilege_type = 'SELECT';
  if detected_public_grants <> 1 then
    raise exception 'PUBLIC privilege detector negative control failed';
  end if;
end
$$;

insert into competition_rate_limit_counters
  (bucket, scope_key, hit_count, reset_at, updated_at)
values
  ('session_start_minute', repeat('a', 64), 1, now() + interval '1 minute', now());

insert into competition_sessions (session_key, expires_at, created_at, updated_at)
values (repeat('b', 64), now() + interval '30 minutes', now(), now());

insert into competition_session_transitions
  (session_key, transition_key, state, expires_at, created_at, updated_at)
values
  (repeat('b', 64), repeat('c', 64), 'committed', now() + interval '30 minutes', now(), now());

insert into competition_idempotency
  (cache_key, state, owner_token, generation, producer_retries, retry_kind,
   expires_at, lease_expires_at, response_ciphertext, response_iv, response_tag,
   response_bytes, created_at, updated_at)
values
  (repeat('d', 64), 'completed', null, 1, 0, null,
   now() + interval '30 minutes', null,
   decode(repeat('01', 32), 'hex'), decode(repeat('02', 12), 'hex'),
   decode(repeat('03', 16), 'hex'), 60, now(), now());

do $$
begin
  begin
    insert into competition_rate_limit_counters
      (bucket, scope_key, hit_count, reset_at, updated_at)
    values ('session_start_minute', '203.0.113.1', 1, now() + interval '1 minute', now());
    raise exception 'a non-HMAC rate-limit scope key was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into competition_session_starts (start_key, expires_at, created_at)
    values ('raw-start-key', now() + interval '30 minutes', now());
    raise exception 'a non-HMAC session-start key was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into competition_sessions (session_key, expires_at, created_at, updated_at)
    values ('raw-session-id', now() + interval '30 minutes', now(), now());
    raise exception 'a non-HMAC session key was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into competition_session_transitions
      (session_key, transition_key, state, expires_at, created_at, updated_at)
    values
      (repeat('9', 64), repeat('8', 64), 'pending', now() + interval '30 minutes', now(), now());
    raise exception 'an orphan session transition was accepted';
  exception when foreign_key_violation then
    null;
  end;

  begin
    insert into competition_idempotency
      (cache_key, state, owner_token, generation, producer_retries,
       expires_at, lease_expires_at)
    values
      ('raw-replay-key', 'pending', '00000000-0000-4000-8000-000000000004'::uuid,
       1, 0, now() + interval '30 minutes', now() + interval '3 minutes');
    raise exception 'a non-HMAC idempotency key was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into competition_idempotency
      (cache_key, state, owner_token, generation, producer_retries, retry_kind,
       expires_at, lease_expires_at)
    values
      (repeat('7', 64), 'completed', null, 1, 0, null,
       now() + interval '30 minutes', null);
    raise exception 'a completed idempotency row without ciphertext was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into competition_idempotency
      (cache_key, state, owner_token, generation, producer_retries, retry_kind,
       expires_at, lease_expires_at, response_ciphertext, response_iv, response_tag,
       response_bytes)
    values
      (repeat('e', 64), 'completed', null, 1, 0, null, now() + interval '30 minutes', null,
       decode('01', 'hex'), decode('02', 'hex'), decode(repeat('03', 16), 'hex'), 29);
    raise exception 'invalid AES-GCM IV was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into competition_idempotency
      (cache_key, state, owner_token, generation, producer_retries, retry_kind,
       expires_at, lease_expires_at)
    values
      (repeat('f', 64), 'pending', '00000000-0000-4000-8000-000000000001'::uuid, 1, 3, null,
       now() + interval '30 minutes', now() + interval '3 minutes');
    raise exception 'a third producer retry was accepted';
  exception when check_violation then
    null;
  end;
end
$$;

insert into ai_model_call_leases (lease_id, expires_at, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000002'::uuid, now() + interval '3 minutes', now(), now());

insert into ai_model_call_waiters (waiter_id, expires_at, enqueued_at)
values ('00000000-0000-4000-8000-000000000003'::uuid, now() + interval '15 seconds', now());

rollback;
