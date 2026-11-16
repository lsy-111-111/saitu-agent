import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createSpendPostgresFixture} from '../helpers/spend-postgres-fixture';
import {reserveAiSpend} from '../../src/lib/ai/spend-ledger';
import {getPool} from '../../src/lib/db/pool';

describe.skipIf(process.env.RUN_SPEND_LEDGER_POSTGRES_TESTS!=='1')('finite renewable development budgets (real PG, no provider)',()=>{
 let fixture:Awaited<ReturnType<typeof createSpendPostgresFixture>>,mainRunId:string,runId:string;
 const original={...process.env};
 const request={system:'Budget isolation',prompt:'No upstream',maxTokens:8192,model:'deepseek-flash',effort:'max'};
 beforeAll(async()=>{fixture=await createSpendPostgresFixture();});
 afterAll(async()=>{await fixture?.close();process.env={...original};});
 beforeEach(async()=>{
  await fixture.admin.query('delete from ai_spend_development_batches');
  mainRunId=`main-${randomUUID()}`;runId=`development-${randomUUID()}`;await fixture.bind(mainRunId);
  await fixture.admin.query(`insert into ai_spend_ledger(id,run_id,model,effort,phase,operation,price_version,reserved_micros,charged_micros,state)
   select gen_random_uuid(),$1,'deepseek-flash','max','calibration','old','test',10,10,'usage_estimated' from generate_series(1,99)`,[mainRunId]);
  await fixture.admin.query(`insert into ai_spend_ledger(id,run_id,model,effort,phase,operation,price_version,reserved_micros,state) values(gen_random_uuid(),$1,'deepseek-flash','max','calibration','unknown','test',390942,'reserved')`,[mainRunId]);
  await fixture.admin.query('insert into ai_spend_budgets(run_id,hard_limit_micros) values($1,50000000)',[runId]);
  await fixture.admin.query(`insert into ai_spend_development_batches(run_id,main_run_id,call_limit,provider_balance_micros,protected_prior_micros,funding_limit_micros,baseline_reservation_ids,authorization_note)
   values($1,$2,64,224300000,390942,223909058,(select array_agg(id) from ai_spend_ledger where run_id=$2),'test explicit grant')`,[runId,mainRunId]);
  Object.assign(process.env,{AI_SPEND_RUN_ID:runId,AI_SPEND_LIMIT_CNY:'50',AI_SPEND_FUNDED_CNY:'50',AI_CALIBRATION_CALL_LIMIT:'64',AI_SPEND_PHASE:'calibration'});
 });
 it('admits a new calibration batch after the historical 100, preserving unknown rows and authority',async()=>{
  const before=(await fixture.admin.query('select * from ai_spend_ledger where run_id=$1 order by id',[mainRunId])).rows;
  const result=await reserveAiSpend(request);expect(result.ok).toBe(true);if(result.ok)await result.reservation.settle(undefined,false);
  expect((await fixture.admin.query('select * from ai_spend_ledger where run_id=$1 order by id',[mainRunId])).rows).toEqual(before);
  expect((await fixture.admin.query('select run_id from ai_spend_authority')).rows[0].run_id).toBe(mainRunId);
  process.env.AI_SPEND_RUN_ID=mainRunId;expect(await reserveAiSpend(request)).toEqual({ok:false,reason:'spend_budget_exhausted'});
 });
 it('uses the granted amount beyond the historical 30 CNY without imposing a new cumulative 300 ceiling',async()=>{
  await fixture.admin.query(`insert into ai_spend_ledger(id,run_id,model,effort,phase,operation,price_version,reserved_micros,charged_micros,state) values(gen_random_uuid(),$1,'deepseek-flash','max','calibration','earlier','test',31000000,31000000,'usage_estimated')`,[runId]);
  process.env.AI_SPEND_LIMIT_CNY='400';process.env.AI_SPEND_FUNDED_CNY='400';
  const result=await reserveAiSpend(request);expect(result.ok).toBe(true);if(result.ok)await result.reservation.settle(undefined,false);
 });
 it('serializes legacy and new reservations against one real-balance funding checkpoint',async()=>{
  await fixture.admin.query('update ai_spend_development_batches set funding_limit_micros=100000 where run_id=$1',[runId]);
  process.env.AI_SPEND_RUN_ID=mainRunId;process.env.AI_SPEND_PHASE='formal';
  const old=await reserveAiSpend(request);expect(old.ok).toBe(true);
  process.env.AI_SPEND_RUN_ID=runId;process.env.AI_SPEND_PHASE='calibration';
  expect(await reserveAiSpend(request)).toEqual({ok:false,reason:'spend_budget_exhausted'});
  if(old.ok)await old.reservation.settle(undefined,false);
  const races=await Promise.all(Array.from({length:10},()=>reserveAiSpend(request)));
  expect(races.filter(row=>row.ok)).toHaveLength(1);
  for(const row of races)if(row.ok)await row.reservation.settle();
 });
 it('rejects arbitrary, closed and non-max batch usage and denies runtime grant mutation',async()=>{
  expect(await reserveAiSpend({...request,effort:'high'})).toEqual({ok:false,reason:'spend_configuration_invalid'});
  await expect(getPool().query('update ai_spend_development_batches set call_limit=100')).rejects.toMatchObject({code:'42501'});
  await fixture.admin.query("update ai_spend_development_batches set state='closed',closed_at=now() where run_id=$1",[runId]);
  expect(await reserveAiSpend(request)).toEqual({ok:false,reason:'spend_configuration_invalid'});
  process.env.AI_SPEND_RUN_ID=`unfunded-${randomUUID()}`;
  expect(await reserveAiSpend(request)).toEqual({ok:false,reason:'spend_configuration_invalid'});
 });
 it('honors the independent finite batch call count',async()=>{
  await fixture.admin.query('update ai_spend_development_batches set call_limit=1 where run_id=$1',[runId]);
  const first=await reserveAiSpend(request);expect(first.ok).toBe(true);if(first.ok)await first.reservation.settle({inputTokens:1,outputTokens:1,cachedInputTokens:0});
  expect(await reserveAiSpend(request)).toEqual({ok:false,reason:'spend_budget_exhausted'});
 });
 it('can explicitly grant more than 100 new calls without changing the historical calibration control',async()=>{
  await fixture.admin.query('update ai_spend_development_batches set call_limit=246 where run_id=$1',[runId]);
  await fixture.admin.query(`insert into ai_spend_ledger(id,run_id,model,effort,phase,operation,price_version,reserved_micros,charged_micros,state)
   select gen_random_uuid(),$1,'deepseek-flash','max','calibration','batch_prior','test',10,10,'usage_estimated' from generate_series(1,100)`,[runId]);
  process.env.AI_CALIBRATION_CALL_LIMIT='100';
  const next=await reserveAiSpend(request);expect(next.ok).toBe(true);if(next.ok)await next.reservation.settle(undefined,false);
 });
});
