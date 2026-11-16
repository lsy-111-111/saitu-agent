-- Forward-only: preserve every historical grant expression and row. The new
-- mode requires the separately approved source, exact policy and fixed trial.
do $rank_nonthinking$
declare old_expression text; new_expression text;
begin
  if not exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_compact_effort_forward_check') then
    raise exception 'compact authorization prerequisite required';
  end if;
  if exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_rank_nonthinking_forward_check') then return; end if;
  select pg_get_expr(conbin,conrelid) into old_expression from pg_constraint
    where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_development_effort_evidence_check';
  if old_expression is null then raise exception 'existing grant evidence constraint required'; end if;
  new_expression := $predicate$
    grant_version='saitu.v7.top5.user-unbounded.v1' and execution_mode='user-unbounded' and call_limit is null
    and run_id ~ ('^saitu-v7-top5-unbounded-20261109-' || authorized_phase || '-[0-9]{2}$')
    and authorized_phase in ('calibration','formal','repair','performance','reserve')
    and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='stage'
    and effort_policy='{"version":"saitu.effort-policy.v2","rank":"low","explain":"low","review":"low","rankThinking":"disabled","rankTemperature":0}'::jsonb
    and effort_policy_sha256='ecd106664dd8656d6a3be9076b8e03f5b32da0c2c5c1c94e2efaf4a2b1da71eb'
    and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_condition)='object'
    and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1'
    and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='stage'
    and effort_condition->>'mainRunId'=main_run_id and effort_condition->>'phase'=authorized_phase
    and effort_condition->>'policySha256'=policy_sha256 and effort_condition->'effortPolicy'=effort_policy
    and effort_condition->>'effortPolicySha256'=effort_policy_sha256
    and effort_condition->>'sourcePolicy'='docs/v7/rank-nonthinking-trial-contract-20261110.md'
    and effort_condition->>'authorization'='user-approved-20261110-rank-nonthinking-temperature-zero'
    and effort_condition->>'policyVersion'='saitu.policy.2026-11-09.v7.top5'
    and effort_condition->>'implementationVersion'='saitu.async.2026-11-09.v7.3.top5'
    and effort_condition->>'priorLedgerSha256' ~ '^[a-f0-9]{64}$'
    and effort_condition->>'executionMode'='user-unbounded'
    and effort_condition->'executionLimits'='{"modelConcurrencyLimit":null,"totalCallLimit":null,"totalCostLimitMicros":null}'::jsonb
    and effort_condition->>'freshPgRowsVerified'='true'
    and effort_condition->'rankModelSettings'='{"thinking":"disabled","policyReasoningEffort":"low","wireReasoningEffort":null,"temperature":0,"topP":1}'::jsonb
    and effort_condition->'developmentTrial'='{"id":"rank-nonthinking-three-20261110-v1","maxReports":3,"slotIds":["completion-dev-06:C:0:rank-nonthinking","completion-dev-10:C:0:rank-nonthinking","completion-dev-10:C:1:rank-nonthinking"]}'::jsonb
    and case when authorized_phase='calibration' then effort_condition->'pilotContinuation'='null'::jsonb
      else jsonb_typeof(effort_condition->'pilotContinuation')='object'
        and effort_condition->'pilotContinuation'->>'complete'='3'
        and effort_condition->'pilotContinuation'->>'detailLayout'='single'
        and effort_condition->'pilotContinuation'->>'effortPolicySha256'=effort_policy_sha256
        and effort_condition->'pilotContinuation'->'slotIds'=effort_condition->'developmentTrial'->'slotIds'
        and effort_condition->'pilotContinuation'->>'proofSha256' ~ '^[a-f0-9]{64}$'
        and effort_condition->'pilotContinuation'->>'sourceBindingsSha256' ~ '^[a-f0-9]{64}$'
        and effort_condition->'pilotContinuation'->>'pilotExecutionSha256' ~ '^[a-f0-9]{64}$'
        and effort_condition->'pilotContinuation'->>'pilotPlanSha256' ~ '^[a-f0-9]{64}$'
      end
  $predicate$;
  alter table ai_spend_development_batches drop constraint ai_spend_development_effort_evidence_check;
  execute format('alter table ai_spend_development_batches add constraint ai_spend_development_effort_evidence_check check (((%s) or (%s)) is true)',old_expression,new_expression);
  execute format($guard$
    alter table ai_spend_development_batches add constraint ai_spend_rank_nonthinking_forward_check
    check (((effort_condition->>'sourcePolicy' is distinct from 'docs/v7/rank-nonthinking-trial-contract-20261110.md'
      and effort_policy->>'version' is distinct from 'saitu.effort-policy.v2') or (%s)) is true)
  $guard$,new_expression);
end
$rank_nonthinking$;

do $rank_nonthinking_calls$
begin
  if exists(select 1 from pg_constraint where conrelid='competition_decision_calls'::regclass and conname='competition_decision_calls_rank_nonthinking_check') then return; end if;
  if not exists(select 1 from pg_constraint where conrelid='competition_decision_calls'::regclass and conname='competition_decision_calls_thinking_check') then
    raise exception 'existing thinking constraint required';
  end if;
  alter table competition_decision_calls drop constraint competition_decision_calls_thinking_check;
  alter table competition_decision_calls add constraint competition_decision_calls_thinking_check
    check ((thinking is null or thinking='enabled' or (thinking='disabled' and operation='competition_v7_rank' and reasoning_effort='low'
      and effort_policy_sha256='ecd106664dd8656d6a3be9076b8e03f5b32da0c2c5c1c94e2efaf4a2b1da71eb')) is true);
  alter table competition_decision_calls add constraint competition_decision_calls_rank_nonthinking_check
    check ((effort_policy_sha256 is distinct from 'ecd106664dd8656d6a3be9076b8e03f5b32da0c2c5c1c94e2efaf4a2b1da71eb'
      or (operation='competition_v7_rank' and thinking='disabled' and reasoning_effort='low')
      or (operation in ('competition_v7_explain','competition_v7_review','competition_recommend') and thinking='enabled' and reasoning_effort='low')
      or (operation in ('competition_v7_chat','competition_v7_extract','competition_v7_chat_review','competition_normalize') and thinking='enabled' and reasoning_effort='high')) is true);
end
$rank_nonthinking_calls$;
