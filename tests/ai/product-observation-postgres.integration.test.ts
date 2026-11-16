import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {createSpendPostgresFixture} from "../helpers/spend-postgres-fixture";
import {getPool} from "@/lib/db/pool";
import {z} from "zod";
import {requestAiJson} from "@/lib/ai/ai-client";
import {withEvaluationTransportFault} from "@/lib/competitions/v6/evaluation-transport-fault";
import {reserveAiSpend} from "@/lib/ai/spend-ledger";
import {withProductObservation,type ProductObservation} from "@/lib/ai/product-observation";
const integration=process.env.RUN_SPEND_LEDGER_POSTGRES_TESTS==="1"?describe:describe.skip;
integration("observer cannot change real PostgreSQL spend settlement (no upstream)",()=>{
 const original={...process.env};let fixture:Awaited<ReturnType<typeof createSpendPostgresFixture>>;beforeAll(async()=>{fixture=await createSpendPostgresFixture();const runId=`observer-fixture-${randomUUID()}`;await fixture.bind(runId);Object.assign(process.env,{AI_SPEND_RUN_ID:runId,AI_SPEND_LIMIT_CNY:"1",AI_SPEND_FUNDED_CNY:"1",AI_SPEND_PHASE:"formal"});});afterAll(async()=>{await fixture?.close();process.env={...original};vi.restoreAllMocks();vi.unstubAllGlobals();});
 it("denies against an isolated real PG cap before any provider transport",async()=>{
  process.env.AI_PROVIDER="deepseek";process.env.AI_API_KEY="fixture-only-not-a-real-key";vi.spyOn(console,"warn").mockImplementation(()=>undefined);
  const native=vi.fn();vi.stubGlobal("fetch",native);const events:ProductObservation[]=[];
  const result=await withProductObservation({observer:e=>{events.push(e);}},()=>withEvaluationTransportFault({fault:"budget_denied",at:"before_dispatch",allowedAttempts:0,maxAdditionalCalls:0,requestAiJsonBoundary:true},()=>requestAiJson("No upstream",{schema:z.object({}),maxAttempts:1,maxTokens:32})));
  expect(result.perturbedResult).toMatchObject({ok:false,reason:"spend_budget_exhausted",upstreamAttempted:false});expect(result.mutationProof).toMatchObject({actualDatabase:true,reservations:0,chargedMicros:0,actualNetworkDispatches:0});expect(events.some(e=>e.type==="ai_budget_denied")).toBe(true);expect(native).not.toHaveBeenCalled();
 });
 it("isolates concurrent reservation/settlement records and charges each exactly once despite throwing observers",async()=>{
  const a:ProductObservation[]=[],b:ProductObservation[]=[];
  const invoke=(events:ProductObservation[],operation:string)=>withProductObservation({observer:async event=>{events.push(event);throw new Error("observer_not_a_business_failure");}},async()=>{const result=await reserveAiSpend({system:"synthetic observer test",prompt:"No provider invocation",maxTokens:32,model:"deepseek-flash",effort:"max",operation});if(!result.ok)throw new Error(result.reason);const settled=await Promise.all([result.reservation.settle({inputTokens:10,cachedInputTokens:0,outputTokens:20}),result.reservation.settle()]);return {id:result.reservation.id,settled};});
  const [left,right]=await Promise.all([invoke(a,"observer-a"),invoke(b,"observer-b")]);
  expect(left.settled).toEqual([0.00018,0.00018]);expect(right.settled).toEqual(left.settled);
  expect(new Set(a.map(e=>e.details.reservationId))).toEqual(new Set([left.id]));expect(new Set(b.map(e=>e.details.reservationId))).toEqual(new Set([right.id]));
  const rows=(await getPool().query("select id,state,charged_micros::text from ai_spend_ledger where id=any($1::uuid[])",[[left.id,right.id]])).rows;expect(rows).toHaveLength(2);expect(rows.every(row=>row.state==="usage_estimated"&&row.charged_micros==="180")).toBe(true);
 });
});
