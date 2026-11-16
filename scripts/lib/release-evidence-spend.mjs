#!/usr/bin/env node
// Root-installed control code. No repository imports, package dependencies, API key or provider network.
import {createHash,randomUUID} from 'node:crypto';
import {lstat,readFile,realpath,writeFile,rename,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const POLICY_PATH='/etc/resume-ai/ai-spend-ledger.json';
export const SERVICE_PATH='/etc/resume-ai/ai-spend-ledger.pg_service.conf';
export const VERIFIER_PATH='/usr/local/lib/resume-ai/release-evidence-deepseek-verifier.mjs';
const SELF_PATH='/usr/local/lib/resume-ai/release-evidence-spend.mjs';
const NODE_PATH='/opt/nodejs/node-v24.20.0-linux-x64/bin/node';
const PSQL_PATH='/usr/bin/psql';
const PRICE='deepseek-flash-cny-20261105-peak-upper-bound';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=message=>{throw new Error(message);};
const run=value=>typeof value==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const phases=['calibration','formal','repair','performance','reserve'];
const isUnbounded=value=>value?.schemaVersion==='release-evidence-budget-permit.v7.top5.user-unbounded.v1';
const isTop5=value=>value?.schemaVersion==='release-evidence-budget-permit.v7.top5.v1'||isUnbounded(value);
const isStage=value=>value?.schemaVersion==='release-evidence-budget-permit.v7.effort.v1'||isTop5(value);
const isV7=value=>value?.schemaVersion==='release-evidence-budget-permit.v7'||isStage(value);
const isUnboundedPolicy=value=>value?.schemaVersion==='release-evidence-spend-policy.v7.top5.user-unbounded.v1';
const isTop5Policy=value=>value?.schemaVersion==='release-evidence-spend-policy.v7.top5.v1'||isUnboundedPolicy(value);
const isStagePolicy=value=>value?.schemaVersion==='release-evidence-spend-policy.v7.effort.v1'||isTop5Policy(value);
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
export function authorizationSha256(value){return hash(canonical(value));}
// Keep root control standalone; cross-checked against the product resolver.
export function parseFixedEffortPolicy(value){
 if(!exact(value,['version','rank','explain','review'])||value.version!=='saitu.effort-policy.v1'||['rank','explain','review'].some(stage=>!['high','low'].includes(value[stage])))fail('invalid fixed effort policy');
 return {version:value.version,rank:value.rank,explain:value.explain,review:value.review};
}
export function fixedEffortPolicySha256(value){return hash(JSON.stringify(parseFixedEffortPolicy(value)));}
const requestEffort=(authorization,operation)=>['saitu.v7.effort.v1','saitu.v7.top5.v1','saitu.v7.top5.user-unbounded.v1'].includes(authorization.grantVersion)&&operation==='competition_recommend'?authorization.effortPolicy.rank:'high';
export function validateV7Authorization(value,runId,phase,stage=false,top5=false,unbounded=false){
 const keys=['mainRunId','grantVersion','policySha256','authorizedEffort','effortConditionSha256','callLimit','funding'];
 if(stage)keys.push('effortPolicy','effortPolicySha256');
 if(unbounded)keys.push('executionMode');
 if(top5&&!stage||unbounded&&!top5)fail('top5 requires stage authorization');
 if(!exact(value,keys)||!run(value.mainRunId)||value.mainRunId===runId||value.grantVersion!==(unbounded?'saitu.v7.top5.user-unbounded.v1':top5?'saitu.v7.top5.v1':stage?'saitu.v7.effort.v1':'saitu.v7')||!sha(value.policySha256)||value.authorizedEffort!==(stage?'stage':'high')||!sha(value.effortConditionSha256)||(unbounded?value.callLimit!==null||value.executionMode!=='user-unbounded':!positive(value.callLimit)||value.callLimit>2147483647)||!phases.includes(phase)||!new RegExp(`^saitu-v7-${unbounded?'top5-unbounded-':top5?'top5-':stage?'effort-':''}20261109-${phase}-[0-9]{2}$`).test(runId??''))fail('invalid v7 batch authorization');
 if(stage&&(!sha(value.effortPolicySha256)||fixedEffortPolicySha256(value.effortPolicy)!==value.effortPolicySha256))fail('invalid v7 effort policy binding');
 if(top5&&['rank','explain','review'].some(key=>value.effortPolicy[key]!=='low'))fail('top5 requires the approved low/low/low policy');
 const f=value.funding;
 if(!exact(f,['runId','createdAt','fundingLimitMicros','baselineIdsSha256'])||!run(f.runId)||typeof f.createdAt!=='string'||!Number.isFinite(Date.parse(f.createdAt))||(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.[0-9]{3,6}Z$/.test(f.createdAt)||new Date(f.createdAt).toISOString().slice(0,19)!==f.createdAt.slice(0,19))||!positive(f.fundingLimitMicros)||!sha(f.baselineIdsSha256))fail('invalid v7 fresh funding checkpoint');
 return value;
}
function validateV7Permit(p){
 if(!uuid(p.permitId)||!sha(p.verifierSha256)||!run(p.runId)||!phases.includes(p.phase)||p.priceVersion!==PRICE||!['prepared','launched','cancelled'].includes(p.state)||(isUnbounded(p)?p.limitMicros!==null||!positive(p.fundedMicros)||p.executionMode!=='user-unbounded':![p.limitMicros,p.fundedMicros].every(positive))||!Array.isArray(p.requests)||p.requests.length!==2||new Set(p.requests.map(r=>r.reservationId)).size!==2||new Set(p.requests.map(r=>r.operation)).size!==2)fail('invalid v7 budget permit shape');
 validateV7Authorization(p.authorization,p.runId,p.phase,isStage(p),isTop5(p),isUnbounded(p));
 if(isUnbounded(p)&&p.fundedMicros!==p.authorization.funding.fundingLimitMicros)fail("unbounded permit must use the actual physical funding checkpoint");
 if(p.authorizationSha256!==authorizationSha256(p.authorization)||!Number.isFinite(Date.parse(p.createdAt))||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=Date.parse(p.createdAt)||Date.parse(p.expiresAt)-Date.parse(p.createdAt)>600000)fail('invalid v7 permit binding or lifetime');
 for(const r of p.requests)if(!uuid(r.reservationId)||!sha(r.requestSha256)||!['competition_normalize','competition_recommend'].includes(r.operation)||r.model!=='deepseek-flash'||r.effort!==requestEffort(p.authorization,r.operation)||r.maxTokens!==8192||!positive(r.reservedMicros)||r.reservedMicros<65536)fail('invalid v7 budget request');
 if(!Number.isSafeInteger(p.requests.reduce((sum,r)=>sum+r.reservedMicros,0)))fail('invalid v7 reservation total');
 return p;
}
export function validateSpendPolicy(value){
 if(value?.schemaVersion==='release-evidence-spend-policy.v7'||isStagePolicy(value)){
  if(!exact(value,['schemaVersion','runId','phase','pgServiceFile','pgService','limitCny','fundedCny','authorization',...(isUnboundedPolicy(value)?['executionMode']:[])])||value.pgServiceFile!==SERVICE_PATH||!/^[a-zA-Z0-9_.-]{1,80}$/.test(value.pgService??'')||(isUnboundedPolicy(value)?value.limitCny!==null||value.executionMode!=='user-unbounded'||typeof value.fundedCny!=='number'||!Number.isFinite(value.fundedCny)||!positive(Math.round(value.fundedCny*1e6)):![value.limitCny,value.fundedCny].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&positive(Math.floor(n*1e6)))))fail('invalid protected v7 shared-spend policy');
  validateV7Authorization(value.authorization,value.runId,value.phase,isStagePolicy(value),isTop5Policy(value),isUnboundedPolicy(value));
  if(isUnboundedPolicy(value)&&Math.round(value.fundedCny*1e6)!==value.authorization.funding.fundingLimitMicros)fail('unbounded policy must use the actual physical funding checkpoint');
  return {...value,limitMicros:isUnboundedPolicy(value)?null:Math.floor(value.limitCny*1e6),fundedMicros:isUnboundedPolicy(value)?Math.round(value.fundedCny*1e6):Math.floor(value.fundedCny*1e6)};
 }
 if(value?.schemaVersion!=='release-evidence-spend-policy.v1'||!/^[a-zA-Z0-9._-]{1,100}$/.test(value.runId??'')||!['calibration','formal','repair','performance','reserve'].includes(value.phase)||value.pgServiceFile!==SERVICE_PATH||!/^[a-zA-Z0-9_.-]{1,80}$/.test(value.pgService??'')||![value.limitCny,value.fundedCny].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=300)||Object.keys(value).some(k=>!['schemaVersion','runId','phase','pgServiceFile','pgService','limitCny','fundedCny'].includes(k)))fail('invalid protected shared-spend policy');
 return {...value,limitMicros:Math.floor(value.limitCny*1e6),fundedMicros:Math.floor(value.fundedCny*1e6)};
}
export function validatePermitShape(permit){
 if(isV7(permit))return validateV7Permit(permit);
 if(permit?.schemaVersion!=='release-evidence-budget-permit.v1'||!uuid(permit.permitId)||!sha(permit.verifierSha256)||!/^[a-zA-Z0-9._-]{1,100}$/.test(permit.runId??'')||!['calibration','formal','repair','performance','reserve'].includes(permit.phase)||permit.priceVersion!==PRICE||!['prepared','launched','cancelled'].includes(permit.state)||![permit.limitMicros,permit.fundedMicros].every(n=>Number.isSafeInteger(n)&&n>0&&n<=300000000)||!Array.isArray(permit.requests)||permit.requests.length!==2||new Set(permit.requests.map(r=>r.reservationId)).size!==2||new Set(permit.requests.map(r=>r.operation)).size!==2)fail('invalid budget permit shape');
 for(const r of permit.requests)if(!uuid(r.reservationId)||!sha(r.requestSha256)||!['competition_normalize','competition_recommend'].includes(r.operation)||r.model!=='deepseek-flash'||r.effort!=='max'||r.maxTokens!==8192||!Number.isSafeInteger(r.reservedMicros)||r.reservedMicros<65536||r.reservedMicros>300000000)fail('invalid budget request shape');
 return permit;
}
const operation=(permit,request,state)=>isV7(permit)?`release-verifier.v7.${permit.permitId}.${authorizationSha256({schemaVersion:permit.schemaVersion,permitId:permit.permitId,createdAt:permit.createdAt,expiresAt:permit.expiresAt,runId:permit.runId,phase:permit.phase,verifierSha256:permit.verifierSha256,limitMicros:permit.limitMicros,fundedMicros:permit.fundedMicros,authorizationSha256:permit.authorizationSha256,requests:permit.requests})}.${state}.${request.requestSha256}`:`release-verifier.${permit.permitId}.${state}.${request.requestSha256}`;
const begin="begin; set local statement_timeout='5000ms'; set local lock_timeout='3000ms'; set local search_path=pg_catalog,public; select pg_catalog.pg_advisory_xact_lock(724310896145225::bigint);";
// The checkpoint hashes the sorted UUID set, never a timestamp cutoff. SHA-256
// is a PostgreSQL core bytea function; no extension or privileged function runs.
function v7GrantChecks(p,additionalMicros,additionalCalls){
 const a=p.authorization,f=a.funding;
 return `
 if not exists(select 1 from public.ai_spend_authority where singleton=true and run_id='${a.mainRunId}') then raise exception 'shared_budget_authority_mismatch'; end if;
 select * into batch from public.ai_spend_development_batches where run_id='${p.runId}';
 if not found or batch.main_run_id<>'${a.mainRunId}' or batch.state<>'active' or batch.grant_version<>'${a.grantVersion}' or batch.authorized_phase<>'${p.phase}' or batch.authorized_effort<>'${a.authorizedEffort}' or batch.policy_sha256 is distinct from '${a.policySha256}' or batch.effort_condition_sha256 is distinct from '${a.effortConditionSha256}' or ${isUnbounded(p)?"batch.call_limit is not null or batch.execution_mode is distinct from 'user-unbounded'":`batch.call_limit<>${a.callLimit}`} then raise exception 'v7_batch_authorization_mismatch'; end if;
 if (batch.effort_condition->>'schemaVersion'='${isUnbounded(p)?'saitu.user-approved-budget-condition.v7.top5.user-unbounded.v1':isTop5(p)?'saitu.user-approved-budget-condition.v7.top5.v1':isStage(p)?'saitu.user-approved-budget-condition.v7.effort.v1':'saitu.user-approved-budget-condition.v7'}' and batch.effort_condition->>'model'='deepseek-flash' and batch.effort_condition->>'effort'='${a.authorizedEffort}' and batch.effort_condition->>'phase'='${p.phase}' and batch.effort_condition->>'policySha256'='${a.policySha256}' and batch.effort_condition->>'authorization'='${isUnbounded(p)?'user-approved-20261109-top5-unbounded-execution':isTop5(p)?'user-approved-20261109-top5-continuation':isStage(p)?'user-approved-20261109-effort-exploration':'user-approved-20261109-continuation'}' and batch.effort_condition->>'freshPgRowsVerified'='true') is not true then raise exception 'v7_effort_condition_mismatch'; end if;
 ${isTop5(p)?`if (batch.effort_condition->>'sourcePolicy'='${isUnbounded(p)?'docs/v7/top5-unbounded-execution-contract-20261109.md':'docs/v7/top5-continuation-contract-20261109.md'}' and batch.effort_condition->>'policyVersion'='saitu.policy.2026-11-09.v7.top5' and batch.effort_condition->>'implementationVersion'='saitu.async.2026-11-09.v7.3.top5') is not true then raise exception 'v7_top5_policy_mismatch'; end if;`:''}
 ${isUnbounded(p)?`if batch.effort_condition->>'executionMode' is distinct from 'user-unbounded' or batch.effort_condition->'executionLimits' is distinct from '{"modelConcurrencyLimit":null,"totalCallLimit":null,"totalCostLimitMicros":null}'::jsonb then raise exception 'v7_execution_mode_mismatch'; end if;`:''}
 ${isStage(p)?`if batch.effort_condition->>'mainRunId' is distinct from '${a.mainRunId}' or batch.effort_policy is distinct from '${JSON.stringify(a.effortPolicy)}'::jsonb or batch.effort_policy_sha256 is distinct from '${a.effortPolicySha256}' or batch.effort_condition->'effortPolicy' is distinct from '${JSON.stringify(a.effortPolicy)}'::jsonb or batch.effort_condition->>'effortPolicySha256' is distinct from '${a.effortPolicySha256}' then raise exception 'v7_effort_policy_mismatch'; end if;`:''}
    select * into funding from public.ai_spend_development_batches order by created_at desc,run_id desc limit 1;
 if not found or array_position(funding.baseline_reservation_ids,null) is not null or exists(select 1 from unnest(funding.baseline_reservation_ids) as checkpoint(reservation_id) where not exists(select 1 from public.ai_spend_ledger l where l.id=checkpoint.reservation_id)) or funding.main_run_id<>'${a.mainRunId}' or funding.run_id<>'${f.runId}' or funding.created_at<>'${f.createdAt}'::timestamptz or funding.funding_limit_micros<>${f.fundingLimitMicros} or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(array_to_string(array(select u::text from unnest(funding.baseline_reservation_ids) u order by u::text),','),'UTF8')),'hex')<>'${f.baselineIdsSha256}' then raise exception 'v7_funding_checkpoint_mismatch'; end if;
 select coalesce(sum(coalesce(charged_micros,reserved_micros)),0) into fresh from public.ai_spend_ledger where (run_id='${a.mainRunId}' or run_id in(select run_id from public.ai_spend_development_batches)) and not(id=any(funding.baseline_reservation_ids));
 if fresh+${additionalMicros}>funding.funding_limit_micros then raise exception 'v7_fresh_funding_exhausted'; end if;
 ${isUnbounded(p)?`select hard_limit_micros into cap from public.ai_spend_budgets where run_id='${p.runId}' and execution_mode='user-unbounded';
 if not found or cap is not null then raise exception 'unbounded_budget_mode_mismatch'; end if;`:`select least(hard_limit_micros,${p.limitMicros},${p.fundedMicros}) into cap from public.ai_spend_budgets where run_id='${p.runId}';
 if cap is null then raise exception 'shared_budget_run_must_already_exist'; end if;`}
 select coalesce(sum(coalesce(charged_micros,reserved_micros)),0),count(*) filter(where state<>'cancelled' and phase='${p.phase}') into spent,phase_calls from public.ai_spend_ledger where run_id='${p.runId}';
 ${isUnbounded(p)?'':`if spent+${additionalMicros}>cap then raise exception 'shared_budget_exhausted'; end if;
 if phase_calls+${additionalCalls}>batch.call_limit then raise exception 'v7_batch_call_limit_exhausted'; end if;`}`;
}
function v7ReservationSql(p){
 const total=p.requests.reduce((sum,r)=>sum+r.reservedMicros,0);
 return `${begin} do $budget$ declare batch public.ai_spend_development_batches%rowtype; funding public.ai_spend_development_batches%rowtype; cap bigint; spent numeric; fresh numeric; phase_calls bigint; begin
 ${v7GrantChecks(p,total,2)}
 ${p.requests.map(r=>`insert into public.ai_spend_ledger(id,run_id,model,effort,${isStage(p)?'effort_policy_sha256,':''}phase,operation,price_version,reserved_micros,state) values('${r.reservationId}','${p.runId}','deepseek-flash','${r.effort}',${isStage(p)?`'${p.authorization.effortPolicySha256}',`:''}'${p.phase}','${operation(p,r,'prepared')}','${PRICE}',${r.reservedMicros},'reserved');`).join('\n')}
 end $budget$; select json_build_object('reserved',2,'runId','${p.runId}','reservedMicros',${total}); commit;`;
}
export function reservationSql(permit){
 validatePermitShape(permit);if(permit.state!=='prepared')fail('reservation requires prepared permit');
 if(isV7(permit))return v7ReservationSql(permit);
 const total=permit.requests.reduce((sum,r)=>sum+r.reservedMicros,0);
 return `${begin}
 do $budget$ declare cap bigint; spent bigint; phase_spent bigint; phase_calls bigint; begin
 if not exists(select 1 from public.ai_spend_authority where singleton=true and run_id='${permit.runId}') then raise exception 'shared_budget_authority_mismatch'; end if;
 select least(hard_limit_micros,${permit.limitMicros},${permit.fundedMicros}) into cap from public.ai_spend_budgets where run_id='${permit.runId}';
 if cap is null then raise exception 'shared_budget_run_must_already_exist'; end if;
 select coalesce(sum(coalesce(charged_micros,reserved_micros)),0) into spent from public.ai_spend_ledger where run_id='${permit.runId}';
 if spent+${total}>cap then raise exception 'shared_budget_exhausted'; end if;
 if '${permit.phase}'='calibration' then
 select coalesce(sum(coalesce(charged_micros,reserved_micros)),0),count(*) filter(where state<>'cancelled') into phase_spent,phase_calls from public.ai_spend_ledger where run_id='${permit.runId}' and phase='calibration';
 if phase_spent+${total}>30000000 or phase_calls+2>100 then raise exception 'calibration_budget_exhausted'; end if; end if;
 ${permit.requests.map(r=>`insert into public.ai_spend_ledger(id,run_id,model,effort,phase,operation,price_version,reserved_micros,state) values('${r.reservationId}','${permit.runId}','deepseek-flash','max','${permit.phase}','${operation(permit,r,'prepared')}','${PRICE}',${r.reservedMicros},'reserved');`).join('\n')}
 end $budget$; select json_build_object('reserved',2,'runId','${permit.runId}','reservedMicros',${total}); commit;`;
}
export function transitionSql(permit,kind){
 validatePermitShape(permit);if(!['claim','cancel'].includes(kind)||permit.state!=='prepared')fail('permit cannot be launched or cancelled twice');
 if(isV7(permit)){
  if(kind==='claim'&&Date.now()>=Date.parse(permit.expiresAt))fail('cannot launch expired permit');
  return `${begin} do $claim$ declare affected int; batch public.ai_spend_development_batches%rowtype; funding public.ai_spend_development_batches%rowtype; cap bigint; spent numeric; fresh numeric; phase_calls bigint; begin
  ${kind==='claim'?v7GrantChecks(permit,0,0):''}
  ${permit.requests.map(r=>`update public.ai_spend_ledger set ${kind==='claim'?`operation='${operation(permit,r,'launched')}'`:"charged_micros=0,state='cancelled',settled_at=now()"} where id='${r.reservationId}' and run_id='${permit.runId}' and state='reserved' and model='deepseek-flash' and effort='${r.effort}' ${isStage(permit)?`and effort_policy_sha256='${permit.authorization.effortPolicySha256}'`:''} and reserved_micros=${r.reservedMicros} and phase='${permit.phase}' and price_version='${PRICE}' and operation='${operation(permit,r,'prepared')}'; get diagnostics affected=row_count; if affected<>1 then raise exception 'permit_already_consumed_or_binding_mismatch'; end if;`).join('\n')}
  end $claim$; select json_build_object('transition','${kind}','reservations',2); commit;`;
 }
 return `${begin} do $claim$ declare affected int; begin
 ${kind==='claim'?`if not exists(select 1 from public.ai_spend_authority where singleton=true and run_id='${permit.runId}') then raise exception 'shared_budget_authority_mismatch'; end if;`:""}
 ${permit.requests.map(r=>`update public.ai_spend_ledger set ${kind==='claim'?`operation='${operation(permit,r,'launched')}'`:"charged_micros=0,state='cancelled',settled_at=now()"} where id='${r.reservationId}' and run_id='${permit.runId}' and state='reserved' and model='deepseek-flash' and effort='max' and reserved_micros=${r.reservedMicros} and phase='${permit.phase}' and price_version='${permit.priceVersion}' and operation='${operation(permit,r,'prepared')}'; get diagnostics affected=row_count; if affected<>1 then raise exception 'permit_already_consumed_or_binding_mismatch'; end if;`).join('\n')}
 end $claim$; select json_build_object('transition','${kind}','reservations',2); commit;`;
}
export function settlementPlan(permit,logBytes,permitSha256){
 validatePermitShape(permit);if(permit.state!=='launched'||!sha(permitSha256))fail('settlement requires launched permit');
 const verifierId=isUnbounded(permit)?'release-evidence-deepseek.v7.top5.user-unbounded.v1':isTop5(permit)?'release-evidence-deepseek.v7.top5.v1':isStage(permit)?'release-evidence-deepseek.v7.effort.v1':isV7(permit)?'release-evidence-deepseek.v7.1':'release-evidence-deepseek.v2';
 const events=[];for(const line of String(logBytes).split(/\r?\n/)){try{const event=JSON.parse(line.replace(/^\[(stdout|stderr)\] /,''));if(event.event==='deepseek_preflight'&&event.verifier===verifierId&&(!isV7(permit)||(event.authorizationSha256===permit.authorizationSha256&&event.mainRunId===permit.authorization.mainRunId&&event.phase===permit.phase&&(!isUnbounded(permit)||event.executionMode==='user-unbounded')))&&event.permitId===permit.permitId&&event.permitSha256===permitSha256&&event.runId===permit.runId)events.push(event);}catch{}}
 return permit.requests.map(request=>{
  const relevant=events.filter(e=>e.reservationId===request.reservationId&&e.requestSha256===request.requestSha256),attempts=relevant.filter(e=>e.operation==='budget_attempt'),terminals=relevant.filter(e=>e.operation==='budget_terminal');
  let state='conservative',chargedMicros=request.reservedMicros,usage=null;
  const terminal=terminals.length===1?terminals[0]:null;
  if(terminal&&attempts.length===0&&terminal.upstreamAttempted===false&&terminal.usage===null){state='cancelled';chargedMicros=0;}
  else if(terminal&&attempts.length===1&&attempts[0].attempt===1&&attempts[0].model==='deepseek-flash'&&attempts[0].reasoningEffort===request.effort&&attempts[0].maxTokens===8192&&terminal.upstreamAttempted===true){
   const u=terminal.usage;if(u&&[u.inputTokens,u.outputTokens,u.cachedInputTokens].every(n=>Number.isSafeInteger(n)&&n>=0)&&u.cachedInputTokens<=u.inputTokens&&u.outputTokens<=8192){const cost=Math.ceil((u.inputTokens-u.cachedInputTokens)*2+u.cachedInputTokens*0.04+u.outputTokens*8);if(cost<=request.reservedMicros){state='usage_estimated';chargedMicros=cost;usage=u;}}
  }
  return {reservationId:request.reservationId,requestSha256:request.requestSha256,operation:request.operation,state,chargedMicros,reservedMicros:request.reservedMicros,usage};
 });
}
export function settlementSql(permit,plan){
 validatePermitShape(permit);if(permit.state!=='launched'||!Array.isArray(plan)||plan.length!==2||new Set(plan.map(item=>item.reservationId)).size!==2)fail('invalid settlement');
 const statements=plan.map(item=>{const request=permit.requests.find(r=>r.reservationId===item.reservationId&&r.requestSha256===item.requestSha256);if(!request||item.operation!==request.operation||item.reservedMicros!==request.reservedMicros||!['conservative','cancelled','usage_estimated'].includes(item.state)||!Number.isSafeInteger(item.chargedMicros)||item.chargedMicros<0||item.chargedMicros>request.reservedMicros)fail('invalid settlement binding');const u=item.usage;if(item.state==='usage_estimated'){if(!u||![u.inputTokens,u.outputTokens,u.cachedInputTokens].every(n=>Number.isSafeInteger(n)&&n>=0)||u.cachedInputTokens>u.inputTokens||u.outputTokens>8192||Math.ceil((u.inputTokens-u.cachedInputTokens)*2+u.cachedInputTokens*0.04+u.outputTokens*8)!==item.chargedMicros)fail('invalid settlement usage');}else if(u!==null||item.chargedMicros!==(item.state==='cancelled'?0:request.reservedMicros))fail('invalid conservative settlement');const immutable=`id='${request.reservationId}' and run_id='${permit.runId}' and operation='${operation(permit,request,'launched')}' and reserved_micros=${request.reservedMicros} and model='${request.model}' and effort='${request.effort}' ${isStage(permit)?`and effort_policy_sha256='${permit.authorization.effortPolicySha256}'`:''} and phase='${permit.phase}' and price_version='${permit.priceVersion}'`;return `update public.ai_spend_ledger set charged_micros=${item.chargedMicros},state='${item.state}',input_tokens=${u?.inputTokens??'null'},output_tokens=${u?.outputTokens??'null'},cached_input_tokens=${u?.cachedInputTokens??'null'},settled_at=now() where ${immutable} and state='reserved'; get diagnostics affected=row_count; if affected<>1 and not exists(select 1 from public.ai_spend_ledger where ${immutable} and state='${item.state}' and charged_micros=${item.chargedMicros} and input_tokens is not distinct from ${u?.inputTokens??'null'}::bigint and output_tokens is not distinct from ${u?.outputTokens??'null'}::bigint and cached_input_tokens is not distinct from ${u?.cachedInputTokens??'null'}::bigint) then raise exception 'settlement_binding_mismatch'; end if;`;});
 return `${begin} do $settle$ declare affected int; begin ${statements.join('\n')} end $settle$; select json_build_object('settled',2,'runId','${permit.runId}'); commit;`;
}
export async function assertRootControlled(filename,{privateFile=false,executable=false}={}){
 if(!path.isAbsolute(filename))fail('protected path must be absolute');
 const resolved=await realpath(filename);
 for(const target of new Set([filename,resolved])){const parts=target.split(path.sep).filter(Boolean);let current='/';for(const component of parts){current=path.join(current,component);const metadata=await lstat(current);if(metadata.uid!==0||(!metadata.isSymbolicLink()&&(metadata.mode&0o022)!==0))fail('protected path is not root-controlled');}}
 const metadata=await lstat(resolved);if(!metadata.isFile()||metadata.nlink!==1||(privateFile&&(metadata.mode&0o077)!==0)||(executable&&(metadata.mode&0o111)===0))fail('protected file permissions are invalid');
 return resolved;
}
async function checkedRootOutputPath(filename){const parent=await assertRootDirectory(path.dirname(filename));if(path.dirname(path.resolve(filename))!==parent)fail('output parent must be canonical');return path.join(parent,path.basename(filename));}
async function assertRootDirectory(directory){const resolved=await realpath(directory);for(let current=resolved;;current=path.dirname(current)){const info=await lstat(current);if(info.uid!==0||!info.isDirectory()||(info.mode&0o022)!==0)fail('private output path is not root-controlled');if(current==='/')break;}return resolved;}
async function protectedPolicy(){await assertRootControlled(POLICY_PATH,{privateFile:true});await assertRootControlled(SERVICE_PATH,{privateFile:true});await assertRootControlled(PSQL_PATH,{executable:true});const bytes=await readFile(POLICY_PATH);if(bytes.length>16000)fail('spend policy too large');return validateSpendPolicy(JSON.parse(bytes.toString('utf8')));}
function query(policy,sql){const result=spawnSync(PSQL_PATH,['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-c',sql],{cwd:'/',env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LANG:'C',PGSERVICEFILE:SERVICE_PATH,PGSERVICE:policy.pgService,PGPASSFILE:'/dev/null',PGCONNECT_TIMEOUT:'5'},encoding:'utf8',timeout:15000,maxBuffer:128*1024});if(result.status!==0)fail('protected shared-budget transaction failed; reservations remain held if committed');const line=result.stdout.split('\n').find(line=>line.startsWith('{'));if(!line)fail('protected budget transaction lacked receipt');return JSON.parse(line);}
async function trustedVerifier(expected){if(!sha(expected))fail('verifier hash required');await assertRootControlled(VERIFIER_PATH,{executable:true});if(hash(await readFile(VERIFIER_PATH))!==expected)fail('fixed verifier differs from reviewed hash');return import(pathToFileURL(VERIFIER_PATH).href);}
function parseArgs(argv){const [command,...rest]=argv;if(!['reserve','claim','cancel','settle'].includes(command))fail('invalid fixed budget command');const options={};for(let i=0;i<rest.length;i+=2){const key=rest[i];if(!['--permit','--verifier-sha256','--log','--output','--run-id','--limit-cny','--funded-cny','--phase','--profile','--policy-sha256','--condition-sha256','--authorized-effort','--effort-policy','--effort-policy-sha256'].includes(key)||!rest[i+1]||Object.hasOwn(options,key))fail('invalid fixed budget arguments');options[key]=rest[i+1];}if(!options['--permit']||!options['--verifier-sha256']||['--run-id','--limit-cny','--funded-cny','--phase'].some(key=>!options[key]))fail('fixed budget permit/hash required');return {command,options};}
export function validatePolicyBinding(options,policy){
 if(options['--run-id']!==policy.runId||options['--phase']!==policy.phase||!isUnboundedPolicy(policy)&&(Number(options['--limit-cny'])!==policy.limitCny||Number(options['--funded-cny'])!==policy.fundedCny))fail('protected policy differs from the active shared AI budget');
 if(policy.schemaVersion==='release-evidence-spend-policy.v7'||isStagePolicy(policy)){
  if(options['--profile']!==(isUnboundedPolicy(policy)?'v7-top5-user-unbounded':isTop5Policy(policy)?'v7-top5':isStagePolicy(policy)?'v7-effort':'v7-high')||options['--authorized-effort']!==policy.authorization.authorizedEffort||options['--policy-sha256']!==policy.authorization.policySha256||options['--condition-sha256']!==policy.authorization.effortConditionSha256)fail('protected v7 authorization differs from caller');
  if(isStagePolicy(policy)){let configured;try{configured=parseFixedEffortPolicy(JSON.parse(options['--effort-policy']));}catch{fail('invalid caller effort policy');}if(fixedEffortPolicySha256(configured)!==policy.authorization.effortPolicySha256||options['--effort-policy-sha256']!==policy.authorization.effortPolicySha256)fail('protected effort policy differs from caller');}else if(['--effort-policy','--effort-policy-sha256'].some(key=>options[key]!==undefined))fail('old high policy cannot authorize a stage profile');
 }else if(['--profile','--authorized-effort','--policy-sha256','--condition-sha256','--effort-policy','--effort-policy-sha256'].some(key=>options[key]!==undefined))fail('legacy policy cannot authorize v7 profile');
}
export function createBudgetPermit(policy,verifierSha256,definitions,now=Date.now()){
 const stage=isStagePolicy(policy),v7=policy.schemaVersion==='release-evidence-spend-policy.v7'||stage;
 const permit={schemaVersion:isUnboundedPolicy(policy)?'release-evidence-budget-permit.v7.top5.user-unbounded.v1':isTop5Policy(policy)?'release-evidence-budget-permit.v7.top5.v1':stage?'release-evidence-budget-permit.v7.effort.v1':v7?'release-evidence-budget-permit.v7':'release-evidence-budget-permit.v1',...(isUnboundedPolicy(policy)?{executionMode:'user-unbounded'}:{}),permitId:randomUUID(),state:'prepared',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString(),runId:policy.runId,phase:policy.phase,limitMicros:policy.limitMicros,fundedMicros:policy.fundedMicros,priceVersion:PRICE,verifierSha256,requests:definitions.map(({operation,requestSha256,reservedMicros})=>({operation,requestSha256,reservedMicros,reservationId:randomUUID(),model:'deepseek-flash',effort:v7?requestEffort(policy.authorization,operation):'max',maxTokens:8192})),...(v7?{authorization:structuredClone(policy.authorization),authorizationSha256:authorizationSha256(policy.authorization)}:{})};
 return validatePermitShape(permit);
}
async function main(){
 if(process.getuid?.()!==0||await realpath(fileURLToPath(import.meta.url))!==SELF_PATH||await realpath(process.execPath)!==NODE_PATH)fail('budget control requires the root-installed fixed runtime');
 await assertRootControlled(SELF_PATH,{executable:true});await assertRootControlled(NODE_PATH,{executable:true});const {command,options}=parseArgs(process.argv.slice(2)),policy=await protectedPolicy(),verifier=await trustedVerifier(options['--verifier-sha256']);
 const filename=await checkedRootOutputPath(options['--permit']);
 if(command==='reserve'){
  validatePolicyBinding(options,policy);
  const profile=isUnboundedPolicy(policy)?'v7-top5-user-unbounded':isTop5Policy(policy)?'v7-top5':isStagePolicy(policy)?'v7-effort':policy.schemaVersion==='release-evidence-spend-policy.v7'?'v7-high':'legacy-v1-max';
  const permit=createBudgetPermit(policy,options['--verifier-sha256'],verifier.fixedRequestDefinitions(profile,policy.authorization?.effortPolicy));
  // Exclusive root capability path; a committed unknown result is never retried.
  await writeFile(filename,JSON.stringify(permit)+'\n',{flag:'wx',mode:0o400});query(policy,reservationSql(permit));process.stdout.write(JSON.stringify({permitId:permit.permitId,runId:permit.runId,permitSha256:hash(await readFile(filename)),reservedMicros:permit.requests.reduce((sum,r)=>sum+r.reservedMicros,0)})+'\n');return;
 }
 await assertRootControlled(filename,{privateFile:true});const bytes=await readFile(filename);if(bytes.length>16000)fail('permit too large');const permit=validatePermitShape(JSON.parse(bytes.toString('utf8')));
 if(permit.verifierSha256!==options['--verifier-sha256'])fail('permit verifier binding differs');
 if(isV7(permit)&&(command==='settle'||command==='cancel')){
  // Closing/changing a grant must not prevent settlement of already incurred
  // costs or cancellation of provably unlaunched rows. SQL binds original rows.
  validatePolicyBinding(options,{schemaVersion:isUnbounded(permit)?'release-evidence-spend-policy.v7.top5.user-unbounded.v1':isTop5(permit)?'release-evidence-spend-policy.v7.top5.v1':isStage(permit)?'release-evidence-spend-policy.v7.effort.v1':'release-evidence-spend-policy.v7',...(isUnbounded(permit)?{executionMode:'user-unbounded'}:{}),runId:permit.runId,phase:permit.phase,limitCny:isUnbounded(permit)?null:permit.limitMicros/1e6,fundedCny:permit.fundedMicros/1e6,authorization:permit.authorization});
 }else{
  validatePolicyBinding(options,policy);
  if(permit.runId!==policy.runId||permit.phase!==policy.phase||permit.limitMicros!==policy.limitMicros||permit.fundedMicros!==policy.fundedMicros||isV7(permit)!==(policy.schemaVersion==='release-evidence-spend-policy.v7'||isStagePolicy(policy))||isStage(permit)!==isStagePolicy(policy)||isTop5(permit)!==isTop5Policy(policy)||isUnbounded(permit)!==isUnboundedPolicy(policy)||(isV7(permit)&&permit.authorizationSha256!==authorizationSha256(policy.authorization)))fail('permit differs from current protected shared-budget policy');
 }
 if(command==='claim'||command==='cancel'){
  if(command==='claim'&&(!Number.isFinite(Date.parse(permit.expiresAt))||Date.now()>=Date.parse(permit.expiresAt)))fail('cannot launch expired permit');query(policy,transitionSql(permit,command));permit.state=command==='claim'?'launched':'cancelled';if(command==='claim')permit.claimedAt=new Date().toISOString();const pending=filename+'.next';await writeFile(pending,JSON.stringify(permit)+'\n',{flag:'wx',mode:0o400});await rename(pending,filename);await chmod(filename,0o400);process.stdout.write(JSON.stringify({permitId:permit.permitId,state:permit.state,permitSha256:hash(await readFile(filename)),runId:permit.runId,reservations:permit.requests.map(r=>r.reservationId)})+'\n');return;
 }
 if(!options['--log']||!options['--output'])fail('settlement log and output required');await assertRootControlled(options['--log'],{privateFile:true});const log=await readFile(options['--log']);if(log.length>12*1024*1024)fail('settlement log too large');verifier.validateBudgetPermit(permit,options['--verifier-sha256'],Date.parse(permit.claimedAt));const plan=settlementPlan(permit,log.toString('utf8'),hash(bytes));query(policy,settlementSql(permit,plan));const output=await checkedRootOutputPath(options['--output']);const receipt={schemaVersion:isUnbounded(permit)?'release-evidence-spend-receipt.v7.top5.user-unbounded.v1':isTop5(permit)?'release-evidence-spend-receipt.v7.top5.v1':isStage(permit)?'release-evidence-spend-receipt.v7.effort.v1':isV7(permit)?'release-evidence-spend-receipt.v7':'release-evidence-spend-receipt.v1',...(isUnbounded(permit)?{executionMode:'user-unbounded'}:{}),at:new Date().toISOString(),permitSha256:hash(bytes),permitId:permit.permitId,verifierSha256:permit.verifierSha256,runId:permit.runId,phase:permit.phase,priceVersion:PRICE,limitMicros:permit.limitMicros,fundedMicros:permit.fundedMicros,logSha256:hash(log),reservations:plan,source:'protected-psql-shared-ledger',controlSha256:hash(await readFile(SELF_PATH)),providerInvoice:false,...(isV7(permit)?{authorization:permit.authorization,authorizationSha256:permit.authorizationSha256}:{})};await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify({receiptSha256:hash(await readFile(output)),runId:permit.runId,permitSha256:hash(bytes)})+'\n');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{process.stderr.write(JSON.stringify({event:'fixed_spend_control',status:'failed',reason:error.message})+'\n');process.exitCode=1;});
