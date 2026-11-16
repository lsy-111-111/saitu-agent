-- Forward-only extension of the existing grant mechanism. No historical row,
-- budget, reservation or authorization is updated. Old branches stay verbatim.
do $compact$
declare old_expression text;
begin
  if exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_compact_effort_forward_check') then
    return;
  end if;
  select pg_get_expr(conbin,conrelid) into old_expression from pg_constraint
    where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_development_effort_evidence_check';
  if old_expression is null or position('saitu.v7.top5.user-unbounded.v1' in old_expression)=0 then
    raise exception 'user-unbounded prerequisite constraint required';
  end if;
  alter table ai_spend_development_batches drop constraint ai_spend_development_effort_evidence_check;
  execute format($check$
    alter table ai_spend_development_batches add constraint ai_spend_development_effort_evidence_check
    check (((%s) or (
      grant_version='saitu.v7.top5.user-unbounded.v1' and execution_mode='user-unbounded' and call_limit is null
      and run_id ~ ('^saitu-v7-top5-unbounded-20261109-' || authorized_phase || '-[0-9]{2}$')
      and authorized_phase in ('calibration','formal','repair','performance','reserve')
      and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='stage'
      and effort_policy_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_policy)='object'
      and effort_policy - array['version','rank','explain','review']='{}'::jsonb
      and effort_policy->>'version'='saitu.effort-policy.v1'
      and effort_policy->>'rank' in ('low','high')
      and effort_policy->>'explain'='low' and effort_policy->>'review'='low'
      and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_condition)='object'
      and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1'
      and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='stage'
      and effort_condition->>'mainRunId'=main_run_id
      and effort_condition->>'phase'=authorized_phase and effort_condition->>'policySha256'=policy_sha256
      and effort_condition->'effortPolicy'=effort_policy
      and effort_condition->>'effortPolicySha256'=effort_policy_sha256
      and effort_condition->>'sourcePolicy'='docs/v7/compact-output-contract-20261110.md'
      and effort_condition->>'policyVersion'='saitu.policy.2026-11-09.v7.top5'
      and effort_condition->>'implementationVersion'='saitu.async.2026-11-09.v7.3.top5'
      and effort_condition->>'authorization'='user-approved-20261110-compact-rank-high'
      and effort_condition->>'priorLedgerSha256' ~ '^[a-f0-9]{64}$'
      and effort_condition->>'executionMode'='user-unbounded'
      and effort_condition->'executionLimits'='{"modelConcurrencyLimit":null,"totalCallLimit":null,"totalCostLimitMicros":null}'::jsonb
      and effort_condition->>'freshPgRowsVerified'='true'
    )) is true)
  $check$,old_expression);
  alter table ai_spend_development_batches add constraint ai_spend_compact_effort_forward_check
    check ((effort_condition->>'sourcePolicy' is distinct from 'docs/v7/compact-output-contract-20261110.md'
      or (grant_version='saitu.v7.top5.user-unbounded.v1' and execution_mode='user-unbounded'
        and effort_policy->>'rank' in ('low','high') and effort_policy->>'explain'='low' and effort_policy->>'review'='low')) is true);
end
$compact$;
