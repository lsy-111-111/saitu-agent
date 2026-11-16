-- Version the explicit user-approved v7 grant without rewriting historical
-- max/high failure evidence or weakening the shared real-balance checkpoint.
alter table ai_spend_development_batches
  add column if not exists grant_version text not null default 'legacy',
  add column if not exists authorized_phase text not null default 'calibration',
  add column if not exists policy_sha256 text;
do $$ begin
if not exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_v7_phase_policy_check')
  or not exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_development_effort_evidence_check') then
  alter table ai_spend_development_batches drop constraint if exists ai_spend_development_effort_evidence_check;
  alter table ai_spend_development_batches drop constraint if exists ai_spend_v7_phase_policy_check;
  -- Retain the old constraint name so replaying the earlier idempotent migration
  -- does not reinstall its narrower predicate over explicitly granted v7 rows.
  alter table ai_spend_development_batches add constraint ai_spend_development_effort_evidence_check check ((
    (grant_version='legacy' and authorized_phase='calibration' and policy_sha256 is null and (
      (authorized_effort='max' and effort_condition_sha256 is null and effort_condition is null)
      or (authorized_effort='high' and effort_condition_sha256 ~ '^[a-f0-9]{64}$'
        and effort_condition is not null and effort_condition->>'schemaVersion'='saitu.max-failure-budget-condition.v1'
        and effort_condition->>'initialEffort'='max' and effort_condition->>'nextPermittedEffort'='high'
        and effort_condition->>'sourceRunId'<>run_id and effort_condition->>'freshPgRowsVerified'='true')))
    or (grant_version='saitu.v7' and authorized_phase in ('calibration','formal','repair','performance','reserve')
      and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='high'
      and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and effort_condition is not null
      and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7'
      and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='high'
      and effort_condition->>'phase'=authorized_phase and effort_condition->>'policySha256'=policy_sha256
      and effort_condition->>'authorization'='user-approved-20261109-continuation'
      and effort_condition->>'freshPgRowsVerified'='true')
  ) is true);
  alter table ai_spend_development_batches add constraint ai_spend_v7_phase_policy_check check (grant_version in ('legacy','saitu.v7'));
end if;
end $$;
