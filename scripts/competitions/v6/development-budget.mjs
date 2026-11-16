// Native local operator command. No model dispatch, recharge or payment changes.
import nextEnv from '@next/env';
import pg from 'pg';
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {verifyHighBudgetCondition} from './high-budget-condition.mjs';
import {prepareEffortBudgetCondition} from './effort-budget-condition.mjs';
import {USER_UNBOUNDED_EXECUTION_LIMITS,USER_UNBOUNDED_GRANT_VERSION,COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY,RANK_NONTHINKING_AUTHORIZATION_POLICY} from '../../../src/lib/ai/execution-policy.mjs';
import { FAST24_REPAIR_AUTHORIZATION_POLICY } from '../../../src/lib/ai/execution-policy.mjs';

import { LOCAL_PREVIEW_AUTHORIZATION_POLICY } from '../../../src/lib/ai/execution-policy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const args=process.argv.slice(2),command=args.shift();
function option(name){const i=args.indexOf(name);return i<0?undefined:args[i+1];}
const v7PolicyFile=option('--v7-policy');
const effortPolicyFile=option('--effort-policy');
const executionMode=option('--execution-mode')??'finite';
if(!['finite','user-unbounded'].includes(executionMode))throw Error('invalid_execution_mode');
const userUnbounded=executionMode==='user-unbounded';
const compactPolicy=Boolean(v7PolicyFile)&&path.resolve(v7PolicyFile)===path.join(root,COMPACT_RECOMMENDATION_AUTHORIZATION_POLICY);
const fastRankPolicy=Boolean(v7PolicyFile)&&path.resolve(v7PolicyFile)===path.join(root,RANK_NONTHINKING_AUTHORIZATION_POLICY);
const step8RepairPolicy=Boolean(v7PolicyFile)&&path.resolve(v7PolicyFile)===path.join(root,FAST24_REPAIR_AUTHORIZATION_POLICY);
const localPreviewPolicy=Boolean(v7PolicyFile)&&path.resolve(v7PolicyFile)===path.join(root,LOCAL_PREVIEW_AUTHORIZATION_POLICY);
function micros(value){if(!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value??''))throw Error('invalid_cny');const [whole,fraction='']=value.split('.');const n=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('unsafe_cny');return n;}
const sha=value=>createHash('sha256').update(value).digest('hex');
async function main(){
 if(!['install','open','close','status'].includes(command))throw Error('expected_install_open_close_or_status');
 nextEnv.loadEnvConfig(root,false,{info(){},error(){}});
 const runtime=new URL(process.env.DATABASE_URL??'');
 if(runtime.hostname!=='127.0.0.1'||runtime.port!=='5432'||runtime.pathname!=='/saitu_upgrade'||decodeURIComponent(runtime.username)!=='saitu_upgrade_runtime')throw Error('reviewed_local_database_required');
 const output=path.resolve(option('--output')??'');if(!option('--output')||![path.join(root,'artifacts/c-sync-20261106/budget/'),path.join(root,'artifacts/continuation-v7-20261109/budget/'),path.join(root,'artifacts/continuation-v7-effort-20261109/budget/'),path.join(root,'artifacts/continuation-v7-top5-20261109/budget/'),path.join(root,'artifacts/compact-20261110/budget/')].some(prefix=>output.startsWith(prefix)))throw Error('new_budget_artifact_directory_required');
 await mkdir(output,{recursive:false,mode:0o700});
 const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 const privateFile=path.join(root,'tmp/postgres/private/admin-password'),mode=(await stat(privateFile)).mode;
 if((mode&0o077)!==0)throw Error('administrator_secret_permissions_unsafe');
 const client=new pg.Client({host:'127.0.0.1',port:5432,user:'saitu_upgrade_admin',password:await readFile(privateFile,'utf8'),database:'saitu_upgrade',connectionTimeoutMillis:3000});
 await client.connect();
 const snapshot=async()=>({authority:(await client.query('select singleton,run_id,created_at from ai_spend_authority order by run_id')).rows,
  budgets:(await client.query('select run_id,hard_limit_micros::text,created_at from ai_spend_budgets order by run_id')).rows,
  ledger:(await client.query('select id::text,run_id,model,effort,phase,operation,price_version,reserved_micros::text,charged_micros::text,state,input_tokens::text,output_tokens::text,cached_input_tokens::text,created_at,settled_at from ai_spend_ledger order by created_at,id')).rows});
 try{
  let balance=null;
  if(command==='open'||command==='status'){
   const response=await fetch('https://api.deepseek.com/user/balance',{headers:{Authorization:`Bearer ${process.env.AI_API_KEY}`},signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error(`balance_http_${response.status}`);
   const result=await response.json(),rows=result.balance_infos?.filter(row=>row.currency==='CNY');
   if(result.is_available!==true||rows?.length!==1)throw Error('available_cny_balance_required');
   balance=micros(rows[0].total_balance);if(balance<=0n)throw Error('positive_provider_balance_required');
  }
  await client.query('begin');await client.query("set local statement_timeout='10000ms'");await client.query("set local lock_timeout='2000ms'");
  await client.query('select pg_advisory_xact_lock(724310896145225::bigint)');
  const before=await snapshot();await save('ledger-before.json',before);
  if(before.authority.length!==1||before.authority[0].run_id!==process.env.AI_SPEND_RUN_ID)throw Error('historical_main_authority_mismatch');
  const mainRunId=before.authority[0].run_id;
  if(command==='install'){
   const prerequisites=(await client.query("select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='ai_spend_development_batches' and column_name in ('effort_policy','effort_policy_sha256')")).rows[0].n;
   if(prerequisites!==2)throw Error('apply_reviewed_historical_migrations_once_before_top5_install');
   // Existing installations apply only this forward migration. Never replay an
   // immutable historical migration over newer grants or accounting evidence.
   const installed=(await client.query("select exists(select 1 from pg_constraint where conrelid='ai_spend_development_batches'::regclass and conname='ai_spend_top5_grant_check') as yes")).rows[0].yes;
   if(!installed)throw Error('apply_reviewed_top5_prerequisite_once_before_execution_upgrade');
   const migration=localPreviewPolicy?'db/migrations/20261112_local_preview_authority.sql':step8RepairPolicy?'db/migrations/20261111_fast24_repair_authority.sql':fastRankPolicy?'db/migrations/20261110_rank_nonthinking_authority.sql':compactPolicy?'db/migrations/20261110_compact_rank_high_authority.sql':'db/migrations/20261109_spend_user_unbounded_execution.sql';
   await client.query(await readFile(path.join(root,migration),'utf8'));
   await client.query('revoke all on ai_spend_development_batches from saitu_upgrade_runtime; grant select on ai_spend_development_batches to saitu_upgrade_runtime');
  }
  const batches=(await client.query('select * from ai_spend_development_batches order by created_at,run_id')).rows;
  const governed=new Set([mainRunId,...batches.map(row=>row.run_id)]);
  const realRows=before.ledger.filter(row=>governed.has(row.run_id));
  const protectedPrior=realRows.filter(row=>['reserved','conservative'].includes(row.state)).reduce((sum,row)=>sum+BigInt(row.charged_micros??row.reserved_micros),0n);
  let opened=null;
  if(command==='open'){
   if(userUnbounded&&(option('--call-limit')!==undefined||option('--cost-cny')!==undefined))throw Error('user_unbounded_must_not_supply_numeric_caps');
   const runId=option('--run-id'),callLimit=userUnbounded?null:Number(option('--call-limit')),cost=userUnbounded?null:micros(option('--cost-cny')),effort=option('--effort')??(effortPolicyFile?'stage':'max');
   if(!['max','high','stage'].includes(effort)||Boolean(effortPolicyFile)!==(effort==='stage'))throw Error('explicit_versioned_stage_or_legacy_max_high_required');
   const phase=v7PolicyFile?(option('--phase')??'calibration'):'calibration';
   if(!['calibration','formal','repair','performance','reserve'].includes(phase))throw Error('invalid_v7_phase');
   const stageGrant=effort==='stage'?await prepareEffortBudgetCondition({root,policyFile:v7PolicyFile,effortPolicyFile,phase,mainRunId,priorLedger:before.ledger,executionMode,pilotProofFile:option('--pilot-proof'),repairValidationFile:option('--repair-validation'),localPreviewFile:option('--local-preview')}):null;
   if(userUnbounded&&stageGrant?.grantVersion!==USER_UNBOUNDED_GRANT_VERSION)throw Error('explicit_user_unbounded_authorization_required');
   if((stageGrant?.grantVersion==='saitu.v7.top5.v1'||userUnbounded)&&!output.startsWith(path.join(root,'artifacts/continuation-v7-top5-20261109/budget/'))&&!((compactPolicy||fastRankPolicy||step8RepairPolicy||localPreviewPolicy)&&output.startsWith(path.join(root,'artifacts/compact-20261110/budget/'))))throw Error('top5_budget_artifact_directory_required');
   if(v7PolicyFile&&!stageGrant&&(effort!=='high'||path.resolve(v7PolicyFile)!==path.join(root,'docs/v7/implementation-contract.md')))throw Error('approved_v7_policy_and_high_required');
   const policySha256=stageGrant?.policySha256??(v7PolicyFile?sha(await readFile(path.resolve(v7PolicyFile))):null);
   if(v7PolicyFile)await writeFile(path.join(output,'approved-policy.md'),await readFile(path.resolve(v7PolicyFile)),{flag:'wx',mode:0o600});
   const condition=stageGrant?.condition??(v7PolicyFile?{schemaVersion:'saitu.user-approved-budget-condition.v7',model:'deepseek-flash',effort:'high',phase,policySha256,authorization:'user-approved-20261109-continuation',freshPgRowsVerified:true,sourcePolicy:'docs/v7/implementation-contract.md',priorLedgerSha256:sha(JSON.stringify(before.ledger))}:effort==='high'?await verifyHighBudgetCondition(client,root):null);
   const conditionSha256=condition?sha(JSON.stringify(condition)):null;
   const validRun=stageGrant?new RegExp(`^${stageGrant.runIdPrefix}-${phase}-[0-9]{2}$`).test(runId??''):v7PolicyFile?new RegExp(`^saitu-v7-20261109-${phase}-[0-9]{2}$`).test(runId??''):/^saitu-c-sync-20261106-[0-9]{2}$/.test(runId??'');
   if(!validRun||!userUnbounded&&(!Number.isSafeInteger(callLimit)||callLimit<1||callLimit>1000||cost<=0n||cost>100000000n))throw Error('finite_operational_batch_required_max_1000_calls_100_cny');
   if(batches.some(row=>row.state==='active'))throw Error('close_current_batch_before_renewal');
   const funding=balance-protectedPrior;
   if(funding<=0n||!userUnbounded&&cost>funding)throw Error('insufficient_real_balance_after_unknown_holds');
   await client.query('insert into ai_spend_budgets(run_id,hard_limit_micros,execution_mode) values($1,$2,$3)',[runId,cost===null?null:String(cost),userUnbounded?'user-unbounded':null]);
   const authorizationNote=localPreviewPolicy?'User-approved 2026-11-12 local_preview on loopback only. Separate reserve batch, no formal acceptance credit. Fresh real balance less unknown holds; no recharge.':step8RepairPolicy?'User-approved 2026-11-11 Fast24 repair validation of one frozen candidate. Fresh real balance less unknown holds.':fastRankPolicy?'User-approved 2026-11-10 fixed three-report trial: rank thinking disabled, temperature 0, top_p 1; explain/review thinking low; profile/chat thinking high. Continuation requires the passed frozen pilot proof; unchanged acceptance gates; fresh real balance less unknown holds; no recharge.':stageGrant?`User-approved 2026-11-09 ${userUnbounded?'Top5 user-unbounded execution; no artificial concurrency, total-call or total-cost limits':stageGrant.grantVersion==='saitu.v7.top5.v1'?'Top5 continuation with frozen Flash/low-low-low policy; finite phase/cost/call bounds':'stage effort exploration with frozen Flash/high-low policy; finite phase/cost/call bounds'}; fresh real balance less unknown holds; no recharge.`:v7PolicyFile?'User-approved 2026-11-09 continuation: Flash/high; explicit finite phase batch; fresh balance less unknown holds; no recharge.':'User 2026-11-06: 放宽预算（预算不限，你先用就行）; public C development only; finite renewable operational batch, no recharge.'+(condition?' Conditional one-step high after pinned full max group fails 4/5.':'');
   await client.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition,grant_version,authorized_phase,policy_sha256,effort_policy,effort_policy_sha256,execution_mode)
    values($1,$2,$3,$4,$5,$6,$7::uuid[],$8,$9,$10,$11::jsonb,$12,$13,$14,$15::jsonb,$16,$17)`,[runId,mainRunId,callLimit,String(balance),String(protectedPrior),String(funding),realRows.map(row=>row.id),authorizationNote,effort,conditionSha256,condition?JSON.stringify(condition):null,stageGrant?stageGrant.grantVersion:v7PolicyFile?'saitu.v7':'legacy',phase,policySha256,stageGrant?JSON.stringify(stageGrant.effortPolicy):null,stageGrant?.effortPolicySha256??null,userUnbounded?'user-unbounded':null]);
   if(condition)await save(stageGrant?'effort-condition-verification.json':'high-condition-verification.json',condition);
   const scopedAuthority=localPreviewPolicy?{runPurpose:condition.runPurpose,localPreview:condition.localPreview}:step8RepairPolicy?{runPurpose:condition.runPurpose,repairValidation:condition.repairValidation,repairAuthorizationRecordSha256:condition.repairAuthorizationRecordSha256}:{};
   opened={runId,mainRunId,phase,model:'deepseek-flash',reasoningEffort:effort,effortConditionSha256:conditionSha256,policySha256,grantVersion:stageGrant?stageGrant.grantVersion:v7PolicyFile?'saitu.v7':'legacy',...(stageGrant?{effortPolicy:stageGrant.effortPolicy,effortPolicySha256:stageGrant.effortPolicySha256}:{}),...(fastRankPolicy||step8RepairPolicy||localPreviewPolicy?{authorizationPolicySource:condition.sourcePolicy,pilotContinuation:condition.pilotContinuation}:{}),...scopedAuthority,callLimit,hardLimitMicros:cost===null?null:String(cost),fundedMicros:String(userUnbounded?funding:cost),providerBalanceMicros:String(balance),protectedPriorMicros:String(protectedPrior),globalFundingLimitMicros:String(funding),renewal:userUnbounded?'No artificial total caps; real provider balance and unknown holds remain authoritative; no recharge.':'close, inspect fresh real balance, open next finite batch; operational size is not a user total ceiling',...(userUnbounded?{executionMode,executionLimits:USER_UNBOUNDED_EXECUTION_LIMITS}:{})};
  }
  if(command==='close'){
   const runId=option('--run-id'),batch=batches.find(row=>row.run_id===runId&&row.state==='active');
   if(!batch)throw Error('active_batch_required');
   if(realRows.some(row=>row.run_id===runId&&row.state==='reserved'))throw Error('inflight_or_unknown_reserved_rows_require_audit_before_close');
   await client.query("update ai_spend_development_batches set state='closed',closed_at=now() where run_id=$1",[runId]);
  }
  const after=await snapshot();
  if(JSON.stringify(before.authority)!==JSON.stringify(after.authority)||JSON.stringify(before.ledger)!==JSON.stringify(after.ledger)||JSON.stringify(before.budgets)!==JSON.stringify(after.budgets.filter(row=>row.run_id!==opened?.runId)))throw Error('historical_ledger_or_authority_changed');
  const privileges=(await client.query("select (select rolsuper from pg_roles where rolname='saitu_upgrade_runtime') as runtime_superuser,has_table_privilege('saitu_upgrade_runtime','ai_spend_budgets','INSERT') as runtime_may_create_budget,has_table_privilege('saitu_upgrade_runtime','ai_spend_authority','UPDATE') as runtime_may_change_authority,has_table_privilege('saitu_upgrade_runtime','ai_spend_development_batches','INSERT') as runtime_may_grant_batch,has_table_privilege('saitu_upgrade_runtime','ai_spend_development_batches','SELECT') as runtime_may_read_batch")).rows[0];
  if(privileges.runtime_superuser||privileges.runtime_may_create_budget||privileges.runtime_may_change_authority||privileges.runtime_may_grant_batch||!privileges.runtime_may_read_batch)throw Error('runtime_privilege_boundary_invalid');
  await save('ledger-after.json',after);
  const receipt={schemaVersion:userUnbounded?'saitu.public-development-budget.user-unbounded.v1':'saitu.public-development-budget.v1',command,observedAt:new Date().toISOString(),paidCalls:0,historicalAuthorityUnchanged:true,historicalLedgerUnchanged:true,priorLedgerSha256:sha(JSON.stringify(before.ledger)),afterPriorLedgerSha256:sha(JSON.stringify(after.ledger)),providerBalanceMicros:balance===null?null:String(balance),protectedPriorMicros:String(protectedPrior),privileges,batch:opened,batches:(await client.query('select * from ai_spend_development_batches order by created_at,run_id')).rows};
  await save('receipt.json',receipt);await client.query('commit');
  if(opened){
   const module=`import nextEnv from '@next/env';\nnextEnv.loadEnvConfig(${JSON.stringify(root)},false,{info(){},error(){}});\nObject.assign(process.env,${JSON.stringify({AI_SPEND_RUN_ID:opened.runId,AI_SPEND_PHASE:opened.phase,AI_SPEND_LIMIT_CNY:opened.hardLimitMicros===null?'':String(Number(opened.hardLimitMicros)/1000000),AI_SPEND_FUNDED_CNY:String(Number(opened.fundedMicros)/1000000),AI_CALIBRATION_CALL_LIMIT:opened.callLimit===null?'':String(Math.min(100,opened.callLimit)),AI_REASONING_EFFORT:opened.reasoningEffort==='stage'?'high':opened.reasoningEffort,AI_SPEND_AUTHORIZED_EFFORT:opened.reasoningEffort,AI_SPEND_HIGH_CONDITION_SHA256:opened.reasoningEffort==='stage'?'':opened.effortConditionSha256??'',AI_SPEND_EFFORT_CONDITION_SHA256:opened.reasoningEffort==='stage'?opened.effortConditionSha256:'',AI_SPEND_POLICY_SHA256:opened.policySha256??'',...(opened.executionMode?{SAITU_AI_EXECUTION_MODE:opened.executionMode}:{}),...(opened.effortPolicy?{SAITU_V7_EFFORT_POLICY:JSON.stringify(opened.effortPolicy),SAITU_V7_EFFORT_POLICY_SHA256:opened.effortPolicySha256}:{})})});\nexport const publicBudget=${JSON.stringify(opened)};\nexport default process.env;\n`;
   await writeFile(path.join(output,'safe-env.mjs'),module,{flag:'wx',mode:0o600});
  }
  console.log(JSON.stringify({output,command,paidCalls:0,providerBalanceMicros:receipt.providerBalanceMicros,protectedPriorMicros:receipt.protectedPriorMicros,batch:opened,privileges}));
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{await client.end();}
}
main().catch(error=>{console.error(typeof error.code==='string'?error.code:error.message);process.exitCode=1;});
