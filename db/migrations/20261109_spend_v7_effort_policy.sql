-- New stage-bound grants are explicit administrator authorizations. Historical
-- legacy max/high and v7 high grants keep their original evidence predicates.
alter table ai_spend_development_batches
  add column if not exists effort_policy jsonb,
  add column if not exists effort_policy_sha256 text;

-- New dispatches retain their resolved policy next to actual operation/effort.
-- Old rows remain NULL: historical receipts are not retrospectively relabeled.
alter table ai_spend_ledger
  add column if not exists effort_policy_sha256 text
    check (effort_policy_sha256 ~ '^[a-f0-9]{64}$');
alter table competition_decision_calls
  add column if not exists operation text,
  add column if not exists dispatch_owner text,
  add column if not exists dispatch_fence bigint,
  add column if not exists thinking text check (thinking='enabled'),
  add column if not exists reasoning_effort text check (reasoning_effort in ('max','high','low')),
  add column if not exists effort_policy_sha256 text
    check (effort_policy_sha256 ~ '^[a-f0-9]{64}$');

alter table ai_spend_development_batches
  drop constraint if exists ai_spend_development_batches_authorized_effort_check;
alter table ai_spend_development_batches
  add constraint ai_spend_development_batches_authorized_effort_check
  check (authorized_effort in ('max','high','stage'));

-- Keep both old constraint names: replaying the prior migrations must not
-- reinstall their narrower predicates over explicitly authorized new rows.
alter table ai_spend_development_batches
  drop constraint if exists ai_spend_development_effort_evidence_check,
  drop constraint if exists ai_spend_v7_phase_policy_check;
alter table ai_spend_development_batches
  add constraint ai_spend_development_effort_evidence_check check ((
    (grant_version='legacy' and authorized_phase='calibration' and policy_sha256 is null
      and effort_policy is null and effort_policy_sha256 is null and (
      (authorized_effort='max' and effort_condition_sha256 is null and effort_condition is null)
      or (authorized_effort='high' and effort_condition_sha256 ~ '^[a-f0-9]{64}$'
        and effort_condition is not null and effort_condition->>'schemaVersion'='saitu.max-failure-budget-condition.v1'
        and effort_condition->>'initialEffort'='max' and effort_condition->>'nextPermittedEffort'='high'
        and effort_condition->>'sourceRunId'<>run_id and effort_condition->>'freshPgRowsVerified'='true')))
    or (grant_version='saitu.v7' and authorized_phase in ('calibration','formal','repair','performance','reserve')
      and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='high'
      and effort_policy is null and effort_policy_sha256 is null
      and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and effort_condition is not null
      and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7'
      and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='high'
      and effort_condition->>'phase'=authorized_phase and effort_condition->>'policySha256'=policy_sha256
      and effort_condition->>'authorization'='user-approved-20261109-continuation'
      and effort_condition->>'freshPgRowsVerified'='true')
    or (grant_version='saitu.v7.effort.v1' and authorized_phase in ('calibration','formal','repair','performance','reserve')
      and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='stage'
      and effort_policy_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_policy)='object'
      and effort_policy - array['version','rank','explain','review']='{}'::jsonb
      and effort_policy->>'version'='saitu.effort-policy.v1'
      and effort_policy->>'rank' in ('high','low')
      and effort_policy->>'explain' in ('high','low')
      and effort_policy->>'review' in ('high','low')
      and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and effort_condition is not null
      and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7.effort.v1'
      and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='stage'
      and effort_condition->>'mainRunId'=main_run_id
      and effort_condition->>'phase'=authorized_phase and effort_condition->>'policySha256'=policy_sha256
      and effort_condition->'effortPolicy'=effort_policy
      and effort_condition->>'effortPolicySha256'=effort_policy_sha256
      and effort_condition->>'authorization'='user-approved-20261109-effort-exploration'
      and effort_condition->>'freshPgRowsVerified'='true')
  ) is true),
  add constraint ai_spend_v7_phase_policy_check
    check (grant_version in ('legacy','saitu.v7','saitu.v7.effort.v1'));
