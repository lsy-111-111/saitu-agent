-- Add the explicitly requested loopback trial without changing historical rows.
do $local_preview$
declare old_evidence text; old_rank_guard text; preview_predicate text;
begin
  if exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass
    and conname='ai_spend_local_preview_forward_check') then return; end if;
  if not exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass
    and conname='ai_spend_fast24_repair_forward_check') then raise exception 'existing repair authority required'; end if;
  select pg_get_expr(conbin,conrelid) into old_evidence from pg_constraint
    where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_development_effort_evidence_check';
  select pg_get_expr(conbin,conrelid) into old_rank_guard from pg_constraint
    where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_rank_nonthinking_forward_check';
  if old_evidence is null or old_rank_guard is null then raise exception 'existing evidence constraints required'; end if;
  preview_predicate := $predicate$
    grant_version='saitu.v7.top5.user-unbounded.v1' and execution_mode='user-unbounded' and call_limit is null
    and authorized_phase='reserve' and run_id ~ '^saitu-v7-top5-unbounded-20261109-reserve-[0-9]{2}$'
    and policy_sha256 ~ '^[a-f0-9]{64}$' and authorized_effort='stage'
    and effort_policy='{"version":"saitu.effort-policy.v2","rank":"low","explain":"low","review":"low","rankThinking":"disabled","rankTemperature":0}'::jsonb
    and effort_policy_sha256='ecd106664dd8656d6a3be9076b8e03f5b32da0c2c5c1c94e2efaf4a2b1da71eb'
    and effort_condition_sha256 ~ '^[a-f0-9]{64}$' and jsonb_typeof(effort_condition)='object'
    and effort_condition->>'schemaVersion'='saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1'
    and effort_condition->>'model'='deepseek-flash' and effort_condition->>'effort'='stage'
    and effort_condition->>'mainRunId'=main_run_id and effort_condition->>'phase'='reserve'
    and effort_condition->>'policySha256'=policy_sha256 and effort_condition->'effortPolicy'=effort_policy
    and effort_condition->>'effortPolicySha256'=effort_policy_sha256
    and effort_condition->>'sourcePolicy'='docs/v7/local-preview-contract-20261112.md'
    and effort_condition->>'authorization'='user-approved-20261112-local-preview'
    and effort_condition->>'policyVersion'='saitu.policy.2026-11-09.v7.top5'
    and effort_condition->>'implementationVersion'='saitu.async.2026-11-09.v7.3.top5'
    and effort_condition->>'priorLedgerSha256' ~ '^[a-f0-9]{64}$'
    and effort_condition->>'executionMode'='user-unbounded'
    and effort_condition->'executionLimits'='{"modelConcurrencyLimit":null,"totalCallLimit":null,"totalCostLimitMicros":null}'::jsonb
    and effort_condition->'freshPgRowsVerified'='true'::jsonb
    and effort_condition->'rankModelSettings'='{"thinking":"disabled","policyReasoningEffort":"low","wireReasoningEffort":null,"temperature":0,"topP":1}'::jsonb
    and effort_condition->'pilotContinuation'='null'::jsonb
    and not (effort_condition ?| array['developmentTrial','repairValidation'])
    and effort_condition->>'runPurpose'='local_preview'
    and jsonb_typeof(effort_condition->'localPreview')='object'
    and (effort_condition->'localPreview') - array['schemaVersion','applicationRuntimeSourceSha256','productionBuildId','candidatePoolSha256','workerArtifactSha256','nextBindingSha256','origin']='{}'::jsonb
    and effort_condition->'localPreview'->>'schemaVersion'='saitu.local-preview.binding.v1'
    and effort_condition->'localPreview'->>'origin'='http://127.0.0.1:3177'
    and jsonb_typeof(effort_condition->'localPreview'->'applicationRuntimeSourceSha256')='string'
    and jsonb_typeof(effort_condition->'localPreview'->'candidatePoolSha256')='string'
    and jsonb_typeof(effort_condition->'localPreview'->'workerArtifactSha256')='string'
    and jsonb_typeof(effort_condition->'localPreview'->'nextBindingSha256')='string'
    and effort_condition->'localPreview'->>'applicationRuntimeSourceSha256' ~ '^[a-f0-9]{64}$'
    and effort_condition->'localPreview'->>'candidatePoolSha256' ~ '^[a-f0-9]{64}$'
    and effort_condition->'localPreview'->>'workerArtifactSha256' ~ '^[a-f0-9]{64}$'
    and effort_condition->'localPreview'->>'nextBindingSha256' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(effort_condition->'localPreview'->'productionBuildId')='string'
    and effort_condition->'localPreview'->>'productionBuildId' ~ '^[A-Za-z0-9_-]{6,128}$'
    and effort_condition->'localPreview'->>'productionBuildId' <> 'development'
  $predicate$;
  alter table ai_spend_development_batches drop constraint ai_spend_development_effort_evidence_check;
  execute format('alter table ai_spend_development_batches add constraint ai_spend_development_effort_evidence_check check (((%s) or (%s)) is true)',old_evidence,preview_predicate);
  alter table ai_spend_development_batches drop constraint ai_spend_rank_nonthinking_forward_check;
  execute format('alter table ai_spend_development_batches add constraint ai_spend_rank_nonthinking_forward_check check (((%s) or (%s)) is true)',old_rank_guard,preview_predicate);
  execute format($guard$
    alter table ai_spend_development_batches add constraint ai_spend_local_preview_forward_check
    check (((effort_condition->>'sourcePolicy' is distinct from 'docs/v7/local-preview-contract-20261112.md'
      and effort_condition->>'runPurpose' is distinct from 'local_preview') or (%s)) is true)
  $guard$,preview_predicate);
end
$local_preview$;
