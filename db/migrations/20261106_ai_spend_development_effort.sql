-- Historical grants keep max. Only an administrator may issue the evidence-
-- bound one-step high grant after a real full max group fails its 4/5 gate.
do $$ begin
if not exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_development_effort_evidence_check') then
alter table ai_spend_development_batches
  add column if not exists authorized_effort text not null default 'max'
    check (authorized_effort in ('max','high')),
  add column if not exists effort_condition_sha256 text,
  add column if not exists effort_condition jsonb;
alter table ai_spend_development_batches
  add constraint ai_spend_development_effort_evidence_check check ((
    (authorized_effort='max' and effort_condition_sha256 is null and effort_condition is null)
    or (authorized_effort='high' and effort_condition_sha256 ~ '^[a-f0-9]{64}$'
      and effort_condition is not null
      and effort_condition->>'schemaVersion'='saitu.max-failure-budget-condition.v1'
      and effort_condition->>'initialEffort'='max'
      and effort_condition->>'nextPermittedEffort'='high'
      and effort_condition->>'sourceRunId'<>run_id
      and effort_condition->>'freshPgRowsVerified'='true')
  ) is true);
end if;
end $$;
