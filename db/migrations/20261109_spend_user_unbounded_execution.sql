-- Explicit additional user authority. Historical grants/budgets/ledger values are not updated.
alter table ai_spend_budgets add column if not exists execution_mode text;
alter table ai_spend_budgets alter column hard_limit_micros drop not null;
alter table ai_spend_budgets drop constraint if exists ai_spend_budget_execution_mode_check;
alter table ai_spend_budgets add constraint ai_spend_budget_execution_mode_check check ((
  (execution_mode is null and hard_limit_micros is not null)
  or (execution_mode='user-unbounded' and hard_limit_micros is null)
) is true);
alter table ai_spend_development_batches add column if not exists execution_mode text;
alter table ai_spend_development_batches alter column call_limit drop not null;
alter table ai_spend_development_batches drop constraint if exists ai_spend_batch_execution_mode_check;
alter table ai_spend_development_batches add constraint ai_spend_batch_execution_mode_check check ((
  (execution_mode is null and call_limit is not null and grant_version<>'saitu.v7.top5.user-unbounded.v1')
  or (execution_mode='user-unbounded' and call_limit is null and grant_version='saitu.v7.top5.user-unbounded.v1')
) is true);
alter table competition_decision_runs add column if not exists execution_mode text
  check (execution_mode in ('finite','user-unbounded'));
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

    or (grant_version='saitu.v7.top5.v1' and run_id ~ ('^saitu-v7-top5-20261109-' || authorized_phase || '-[0-9]{2}$')
      and authorized_phase in ('calibration','formal','repair','performance','reserve')
      and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='stage'
      and effort_policy_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_policy)='object'
      and effort_policy = '{"version":"saitu.effort-policy.v1","rank":"low","explain":"low","review":"low"}'::jsonb
      and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_condition)='object'
      and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7.top5.v1'
      and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='stage'
      and effort_condition->>'mainRunId'=main_run_id
      and effort_condition->>'phase'=authorized_phase and effort_condition->>'policySha256'=policy_sha256
      and effort_condition->'effortPolicy'=effort_policy
      and effort_condition->>'effortPolicySha256'=effort_policy_sha256
      and effort_condition->>'sourcePolicy'='docs/v7/top5-continuation-contract-20261109.md'
      and effort_condition->>'policyVersion'='saitu.policy.2026-11-09.v7.top5'
      and effort_condition->>'implementationVersion'='saitu.async.2026-11-09.v7.3.top5'
      and effort_condition->>'authorization'='user-approved-20261109-top5-continuation'
      and effort_condition->>'priorLedgerSha256' ~ '^[a-f0-9]{64}$'
      and effort_condition->>'freshPgRowsVerified'='true')
    or (grant_version='saitu.v7.top5.user-unbounded.v1' and execution_mode='user-unbounded' and call_limit is null and run_id ~ ('^saitu-v7-top5-unbounded-20261109-' || authorized_phase || '-[0-9]{2}$')
      and authorized_phase in ('calibration','formal','repair','performance','reserve')
      and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='stage'
      and effort_policy_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_policy)='object'
      and effort_policy = '{"version":"saitu.effort-policy.v1","rank":"low","explain":"low","review":"low"}'::jsonb
      and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_condition)='object'
      and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1'
      and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='stage'
      and effort_condition->>'mainRunId'=main_run_id
      and effort_condition->>'phase'=authorized_phase and effort_condition->>'policySha256'=policy_sha256
      and effort_condition->'effortPolicy'=effort_policy
      and effort_condition->>'effortPolicySha256'=effort_policy_sha256
      and effort_condition->>'sourcePolicy'='docs/v7/top5-unbounded-execution-contract-20261109.md'
      and effort_condition->>'policyVersion'='saitu.policy.2026-11-09.v7.top5'
      and effort_condition->>'implementationVersion'='saitu.async.2026-11-09.v7.3.top5'
      and effort_condition->>'authorization'='user-approved-20261109-top5-unbounded-execution'
      and effort_condition->>'priorLedgerSha256' ~ '^[a-f0-9]{64}$'
      and effort_condition->>'executionMode'='user-unbounded'
      and effort_condition->'executionLimits'='{"modelConcurrencyLimit":null,"totalCallLimit":null,"totalCostLimitMicros":null}'::jsonb
      and effort_condition->>'freshPgRowsVerified'='true')
  ) is true),
  add constraint ai_spend_v7_phase_policy_check
    check (grant_version in ('legacy','saitu.v7','saitu.v7.effort.v1','saitu.v7.top5.v1','saitu.v7.top5.user-unbounded.v1'));

alter table ai_spend_development_batches drop constraint if exists ai_spend_top5_grant_check;
alter table ai_spend_development_batches add constraint ai_spend_top5_grant_check
  check (grant_version in ('legacy','saitu.v7','saitu.v7.effort.v1','saitu.v7.top5.v1','saitu.v7.top5.user-unbounded.v1'));
