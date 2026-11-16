import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createSpendPostgresFixture} from '../helpers/spend-postgres-fixture';
import {reserveAiSpend} from '../../src/lib/ai/spend-ledger';
import {getConfiguredReasoningEffort,requestAiJson} from '../../src/lib/ai/ai-client';
import {verifyHighBudgetCondition,HIGH_CONDITION_INPUTS} from '../../scripts/competitions/v6/high-budget-condition.mjs';

describe.skipIf(process.env.RUN_SPEND_LEDGER_POSTGRES_TESTS!=='1')('conditional high grant after pinned full max failure (PG, no provider)',()=>{
 let fixture:Awaited<ReturnType<typeof createSpendPostgresFixture>>,proof:Awaited<ReturnType<typeof verifyHighBudgetCondition>>,temporary:string;
 const original={...process.env},root=process.cwd(),newRun='saitu-c-sync-20261106-93';
 const request={system:'Budget only',prompt:'No provider request',maxTokens:8192,model:'deepseek-flash',effort:'high'};
 beforeAll(async()=>{
  fixture=await createSpendPostgresFixture();
  const snapshot=JSON.parse(await readFile(path.join(HIGH_CONDITION_INPUTS.directory,'ledger-after.json'),'utf8'));
  for(const row of snapshot.budgets)await fixture.admin.query('insert into ai_spend_budgets(run_id,hard_limit_micros,created_at) values($1,$2,$3)',[row.run_id,row.hard_limit_micros,row.created_at]);
  await fixture.admin.query('insert into ai_spend_authority(singleton,run_id,created_at) values(true,$1,$2)',[snapshot.authority[0].run_id,snapshot.authority[0].created_at]);
  await fixture.admin.query(`insert into ai_spend_ledger select id::uuid,run_id,model,effort,phase,operation,price_version,reserved_micros::bigint,charged_micros::bigint,state,input_tokens::bigint,output_tokens::bigint,cached_input_tokens::bigint,created_at::timestamptz,settled_at::timestamptz
   from jsonb_to_recordset($1::jsonb) as x(id text,run_id text,model text,effort text,phase text,operation text,price_version text,reserved_micros text,charged_micros text,state text,input_tokens text,output_tokens text,cached_input_tokens text,created_at text,settled_at text)`,[JSON.stringify(snapshot.rows)]);
  proof=await verifyHighBudgetCondition(fixture.admin,root);
  await fixture.admin.query('insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,30000000)',[newRun]);
  await fixture.admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note,authorized_effort,effort_condition_sha256,effort_condition)
   values($1,$2,246,224300000,21267548,203032452,(select array_agg(id) from ai_spend_ledger),'explicit test condition','high',$3,$4::jsonb)`,[newRun,snapshot.authority[0].run_id,createHash('sha256').update(JSON.stringify(proof)).digest('hex'),JSON.stringify(proof)]);
  Object.assign(process.env,{AI_SPEND_RUN_ID:newRun,AI_SPEND_LIMIT_CNY:'30',AI_SPEND_FUNDED_CNY:'30',AI_SPEND_PHASE:'calibration',AI_CALIBRATION_CALL_LIMIT:'100',AI_REASONING_EFFORT:'high',AI_SPEND_AUTHORIZED_EFFORT:'high',AI_SPEND_HIGH_CONDITION_SHA256:createHash('sha256').update(JSON.stringify(proof)).digest('hex')});
  temporary=await mkdtemp(path.join(os.tmpdir(),'saitu-high-condition-'));
 });
 afterAll(async()=>{await fixture?.close();if(temporary)await rm(temporary,{recursive:true,force:true});process.env={...original};});
 it('verifies the real raw five-page artifacts and all 200 matching PG rows',()=>{
  expect(proof).toMatchObject({initialEffort:'max',nextPermittedEffort:'high',registeredPages:5,executedPages:5,successfulPages:0,candidateCount:39,distinctCandidateOrders:5,processConcurrency:40,providerHttp:200,freshPgRowsVerified:true,accountedMicros:'5546161'});
 });
 it('admits only the fixed high effort and preserves default max on legacy grants',async()=>{
  expect(getConfiguredReasoningEffort()).toBe('high');
  delete process.env.AI_SPEND_AUTHORIZED_EFFORT;expect(getConfiguredReasoningEffort()).toBe('max');
  expect(await reserveAiSpend(request)).toEqual({ok:false,reason:'spend_configuration_invalid'});
  process.env.AI_SPEND_AUTHORIZED_EFFORT='high';
  const digest=process.env.AI_SPEND_HIGH_CONDITION_SHA256;process.env.AI_SPEND_HIGH_CONDITION_SHA256='0'.repeat(64);
  expect(await reserveAiSpend(request)).toEqual({ok:false,reason:'spend_configuration_invalid'});process.env.AI_SPEND_HIGH_CONDITION_SHA256=digest;
  for(const effort of ['max','low'])expect(await reserveAiSpend({...request,effort})).toEqual({ok:false,reason:'spend_configuration_invalid'});
  const accepted=await reserveAiSpend(request);expect(accepted.ok).toBe(true);if(accepted.ok)await accepted.reservation.settle(undefined,false);
  expect((await fixture.admin.query("select column_default from information_schema.columns where table_name='ai_spend_development_batches' and column_name='authorized_effort'")).rows[0].column_default).toContain('max');
 });
 it('refuses a changed fresh PG charge even when summary and pinned audit still claim max failure',async()=>{
  const id=proof.freshReservationIds[0],row=(await fixture.admin.query('select charged_micros::text from ai_spend_ledger where id=$1',[id])).rows[0];
  await fixture.admin.query('update ai_spend_ledger set charged_micros=charged_micros+1 where id=$1',[id]);
  await expect(verifyHighBudgetCondition(fixture.admin,root)).rejects.toThrow('fresh_pg_row_differs');
  await fixture.admin.query('update ai_spend_ledger set charged_micros=$2 where id=$1',[id,row.charged_micros]);
 });
 it('sends actual high payload metadata only through its PG-authorized grant (synthetic fetch)',async()=>{
  Object.assign(process.env,{AI_PROVIDER:'deepseek',AI_API_KEY:'synthetic-only-never-sent',AI_TEST_MODE:'0',ALLOW_AI_MOCK:'0'});
  let body:Record<string,unknown>|undefined;
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,options:RequestInit)=>{body=JSON.parse(String(options.body));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],usage:{prompt_tokens:10,completion_tokens:10,prompt_cache_hit_tokens:0}}));}));
  try{const result=await requestAiJson('Synthetic high gate JSON',{maxAttempts:1,maxTokens:8192});expect(result.ok).toBe(true);expect(body).toMatchObject({model:'deepseek-flash',thinking:{type:'enabled'},reasoning_effort:'high'});}finally{vi.unstubAllGlobals();}
 });
 it('rejects forged failure data before granting regardless of its self-reported summary',async()=>{
  const directory=path.join(temporary,HIGH_CONDITION_INPUTS.directory),coord=path.join(temporary,HIGH_CONDITION_INPUTS.coordinationPath);
  await mkdir(directory,{recursive:true});await mkdir(path.dirname(coord),{recursive:true});
  const audit=JSON.parse(await readFile(path.join(root,HIGH_CONDITION_INPUTS.directory,'audit.json'),'utf8'));audit.successfulPages=0;audit.providerHttp=1;
  await writeFile(path.join(directory,'audit.json'),JSON.stringify(audit));await writeFile(coord,await readFile(path.join(root,HIGH_CONDITION_INPUTS.coordinationPath)));
  await expect(verifyHighBudgetCondition(fixture.admin,temporary)).rejects.toThrow('approved_max_audit_changed');
 });
 it('rejects malformed high evidence and runtime edits at the database boundary',async()=>{
  await expect(fixture.admin.query("update ai_spend_development_batches set effort_condition='{}'::jsonb where run_id=$1",[newRun])).rejects.toMatchObject({code:'23514'});
  await expect(fixture.admin.query("update ai_spend_development_batches set authorized_effort='low' where run_id=$1",[newRun])).rejects.toMatchObject({code:'23514'});
 });
});
