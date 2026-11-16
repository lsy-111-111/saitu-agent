import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {z} from "zod";
import {createSpendPostgresFixture} from "../helpers/spend-postgres-fixture";
import {requestAiJson} from "@/lib/ai/ai-client";
import {getPool} from "@/lib/db/pool";
const enabled=process.env.RUN_SPEND_LEDGER_POSTGRES_TESTS==="1";
describe.skipIf(!enabled)("actual requestAiJson HTTP and administrator-bound PG ledger; no provider",()=>{
 const original={...process.env};let fixture:Awaited<ReturnType<typeof createSpendPostgresFixture>>,runId:string;const fetchMock=vi.fn();
 beforeAll(async()=>{fixture=await createSpendPostgresFixture();Object.assign(process.env,{AI_PROVIDER:"deepseek",AI_API_KEY:"synthetic-only-never-send",AI_MODEL:"deepseek-flash",AI_REASONING_EFFORT:"max",AI_SPEND_LIMIT_CNY:"300",AI_SPEND_FUNDED_CNY:"130.02",AI_SPEND_PHASE:"formal"});});
 beforeEach(async()=>{runId=`transport-test-${randomUUID()}`;await fixture.bind(runId);process.env.AI_SPEND_RUN_ID=runId;process.env.AI_SPEND_FUNDED_CNY="130.02";fetchMock.mockReset();vi.stubGlobal("fetch",fetchMock);vi.spyOn(console,"warn").mockImplementation(()=>{});});
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});afterAll(async()=>{await fixture?.close();process.env={...original};});
 const request=()=>requestAiJson("Synthetic usage boundary",{schema:z.object({answer:z.string()}),maxTokens:128,maxAttempts:1});
 const response=(usage:unknown,content=JSON.stringify({answer:"fixture"}))=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content}}],usage}),{status:200,headers:{"content-type":"application/json"}});
 const row=async()=> (await getPool().query("select state,reserved_micros::text,charged_micros::text,input_tokens,output_tokens,cached_input_tokens from ai_spend_ledger where run_id=$1",[runId])).rows[0];
 it("rejects absent/mismatched main run before HTTP and never creates a fresh budget",async()=>{for(const existing of [false,true]){const wrong=`wrong-${randomUUID()}`;if(existing)await fixture.admin.query("insert into ai_spend_budgets values($1,300000000,now())",[wrong]);process.env.AI_SPEND_RUN_ID=wrong;expect(await request()).toMatchObject({ok:false,reason:"spend_configuration_invalid",upstreamAttempted:false});expect((await getPool().query("select count(*)::int n from ai_spend_budgets where run_id=$1",[wrong])).rows[0].n).toBe(existing?1:0);}expect(fetchMock).not.toHaveBeenCalled();});
 it("requires initialized authority and enforces runtime SELECT-only policy",async()=>{await fixture.admin.query("delete from ai_spend_authority");expect(await request()).toMatchObject({ok:false,reason:"spend_configuration_invalid",upstreamAttempted:false});await expect(getPool().query("insert into ai_spend_authority values(true,$1,now())",[runId])).rejects.toThrow(/permission denied/);await expect(getPool().query("insert into ai_spend_budgets values('bypass',300000000,now())")).rejects.toThrow(/permission denied/);expect(fetchMock).not.toHaveBeenCalled();});
 it("counts old charges and unknown attempts across phases before transport",async()=>{await fixture.admin.query("insert into ai_spend_ledger(id,run_id,model,effort,phase,operation,price_version,reserved_micros,charged_micros,state) values(gen_random_uuid(),$1,'deepseek-flash','max','calibration','prior-charge','test',100000000,100000000,'usage_estimated'),(gen_random_uuid(),$1,'deepseek-flash','max','performance','prior-unknown','test',30020000,null,'reserved')",[runId]);expect(await request()).toMatchObject({ok:false,reason:"spend_budget_exhausted",upstreamAttempted:false});expect(fetchMock).not.toHaveBeenCalled();});
 it.each([
  {prompt_tokens:100,completion_tokens:50,prompt_cache_hit_tokens:1000},
  {prompt_tokens:100.5,completion_tokens:50,prompt_cache_hit_tokens:0},
  {prompt_tokens:100,completion_tokens:-1,prompt_cache_hit_tokens:0},
  {prompt_tokens:100,completion_tokens:129,prompt_cache_hit_tokens:0},
  {prompt_tokens:99999999,completion_tokens:50,prompt_cache_hit_tokens:0},
  {prompt_tokens:100,completion_tokens:50,prompt_cache_hit_tokens:-1},
  {prompt_tokens:100,completion_tokens:50,prompt_cache_hit_tokens:null},
  {prompt_tokens:100,completion_tokens:50,prompt_cache_hit_tokens:Number.MAX_SAFE_INTEGER+1},
 ])("retains full reservation for contradictory raw counters %j",async usage=>{fetchMock.mockResolvedValue(response(usage));expect(await request()).toMatchObject({ok:true});expect(fetchMock).toHaveBeenCalledOnce();const saved=await row();expect(saved.state).toBe("conservative");expect(saved.charged_micros).toBe(saved.reserved_micros);expect(saved.input_tokens).toBeNull();});
 it("settles valid usage even when actual provider content fails JSON parsing",async()=>{fetchMock.mockResolvedValue(response({prompt_tokens:100,completion_tokens:50,prompt_cache_hit_tokens:20},"not-json"));expect(await request()).toMatchObject({ok:false,upstreamAttempted:true});expect(fetchMock).toHaveBeenCalledOnce();expect(await row()).toMatchObject({state:"usage_estimated",charged_micros:"561",input_tokens:"100",output_tokens:"50",cached_input_tokens:"20"});});
});
