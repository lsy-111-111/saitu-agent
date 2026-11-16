-- Add the approved Fast24 repair purpose while retaining the existing trial and
-- continuation predicates and all historical grants.
do $fast24_repair$
declare old_evidence text; old_rank_guard text; repair_predicate text;
begin
  if exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass
    and conname='ai_spend_fast24_repair_forward_check') then return; end if;

  select pg_get_expr(conbin,conrelid) into old_evidence from pg_constraint
    where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_development_effort_evidence_check';
  select pg_get_expr(conbin,conrelid) into old_rank_guard from pg_constraint
    where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_rank_nonthinking_forward_check';
  if old_evidence is null or old_rank_guard is null then
    raise exception 'existing rank nonthinking authorization required';
  end if;

  repair_predicate := $predicate$
    grant_version='saitu.v7.top5.user-unbounded.v1' and execution_mode='user-unbounded' and call_limit is null
    and authorized_phase='repair' and run_id ~ '^saitu-v7-top5-unbounded-20261109-repair-[0-9]{2}$'
    and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='stage'
    and effort_policy='{"version":"saitu.effort-policy.v2","rank":"low","explain":"low","review":"low","rankThinking":"disabled","rankTemperature":0}'::jsonb
    and effort_policy_sha256='ecd106664dd8656d6a3be9076b8e03f5b32da0c2c5c1c94e2efaf4a2b1da71eb'
    and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_condition)='object'
    and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1'
    and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='stage'
    and effort_condition->>'mainRunId'=main_run_id and effort_condition->>'phase'='repair'
    and effort_condition->>'policySha256'=policy_sha256 and effort_condition->'effortPolicy'=effort_policy
    and effort_condition->>'effortPolicySha256'=effort_policy_sha256
    and effort_condition->>'sourcePolicy'='docs/v7/step8-first-delivery-20261111.md'
    and effort_condition->>'authorization'='user-approved-20261111-fast24-step8-first'
    and effort_condition->>'policyVersion'='saitu.policy.2026-11-09.v7.top5'
    and effort_condition->>'implementationVersion'='saitu.async.2026-11-09.v7.3.top5'
    and effort_condition->>'priorLedgerSha256' ~ '^[a-f0-9]{64}$'
    and effort_condition->>'executionMode'='user-unbounded'
    and effort_condition->'executionLimits'='{"modelConcurrencyLimit":null,"totalCallLimit":null,"totalCostLimitMicros":null}'::jsonb
    and effort_condition->'freshPgRowsVerified'='true'::jsonb
    and effort_condition->'rankModelSettings'='{"thinking":"disabled","policyReasoningEffort":"low","wireReasoningEffort":null,"temperature":0,"topP":1}'::jsonb
    and effort_condition->'pilotContinuation'='null'::jsonb and not (effort_condition ? 'developmentTrial')
    and effort_condition->>'runPurpose'='repair_validation'
    and effort_condition->>'repairAuthorizationRecordSha256' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(effort_condition->'repairValidation')='object'
    and (effort_condition->'repairValidation') - array['schemaVersion','selectionSha256','applicationRuntimeSourceSha256','productionBuildId','candidatePoolSha256']='{}'::jsonb
    and effort_condition->'repairValidation'->>'schemaVersion'='saitu.fast24.repair-validation.v1'
    and jsonb_typeof(effort_condition->'repairValidation'->'selectionSha256')='string'
    and jsonb_typeof(effort_condition->'repairValidation'->'applicationRuntimeSourceSha256')='string'
    and jsonb_typeof(effort_condition->'repairValidation'->'candidatePoolSha256')='string'
    and jsonb_typeof(effort_condition->'repairValidation'->'productionBuildId')='string'
    and effort_condition->'repairValidation'->>'selectionSha256' ~ '^[a-f0-9]{64}$'
    and effort_condition->'repairValidation'->>'applicationRuntimeSourceSha256' ~ '^[a-f0-9]{64}$'
    and effort_condition->'repairValidation'->>'candidatePoolSha256' ~ '^[a-f0-9]{64}$'
    and effort_condition->'repairValidation'->>'productionBuildId' ~ '^[A-Za-z0-9_-]{6,128}$'
    and effort_condition->'repairValidation'->>'productionBuildId' <> 'development'
  $predicate$;

  alter table ai_spend_development_batches drop constraint ai_spend_development_effort_evidence_check;
  execute format('alter table ai_spend_development_batches add constraint ai_spend_development_effort_evidence_check check (((%s) or (%s)) is true)',old_evidence,repair_predicate);
  alter table ai_spend_development_batches drop constraint ai_spend_rank_nonthinking_forward_check;
  execute format('alter table ai_spend_development_batches add constraint ai_spend_rank_nonthinking_forward_check check (((%s) or (%s)) is true)',old_rank_guard,repair_predicate);
  execute format($guard$
    alter table ai_spend_development_batches add constraint ai_spend_fast24_repair_forward_check
    check (((effort_condition->>'sourcePolicy' is distinct from 'docs/v7/step8-first-delivery-20261111.md'
      and effort_condition->>'runPurpose' is distinct from 'repair_validation') or (%s)) is true)
  $guard$,repair_predicate);
end
$fast24_repair$;
