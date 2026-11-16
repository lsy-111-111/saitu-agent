import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const database=vi.hoisted(()=>({pool:undefined as {connect:()=>Promise<unknown>}|undefined}));
vi.mock("@/lib/db/pool",async importOriginal=>{const actual=await importOriginal<typeof import("@/lib/db/pool")>();return {getPool:()=>database.pool??actual.getPool(),isDatabaseConfigured:()=>Boolean(database.pool)||actual.isDatabaseConfigured()};});
vi.mock("@/lib/ai/execution-authorization",()=>({readUserUnboundedExecutionAuthorizationV7:vi.fn(async()=>({runId:"synthetic-verified-new-grant"}))}));
vi.mock("@/lib/ai/spend-ledger",async importOriginal=>({...await importOriginal<typeof import("@/lib/ai/spend-ledger")>(),reserveAiSpend:vi.fn(async()=>({ok:true as const,reservation:{id:"synthetic-reservation",reservedMicros:0,settle:async()=>0}}))}));
import {requestAiJson} from "@/lib/ai/ai-client";
import {reserveAiSpend} from "@/lib/ai/spend-ledger";
import {readUserUnboundedExecutionAuthorizationV7} from "@/lib/ai/execution-authorization";
import {getModelCallGovernorConfigurationSnapshot,providerCapacityReadyForNewWorkV7,recordModelCallCapacityFeedbackV7,resetModelCallGovernorForTests} from "@/lib/ai/model-call-governor";
const original={...process.env},options={operation:"competition_v7_rank",maxAttempts:3 as const,maxTokens:32};
const successful=()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:'{"ok":true}'}}],usage:{prompt_tokens:10,completion_tokens:5,prompt_cache_hit_tokens:0}}));
beforeEach(()=>{process.env={...original};delete process.env.DATABASE_URL;Object.assign(process.env,{SAITU_AI_EXECUTION_MODE:"user-unbounded",AI_PROVIDER:"deepseek",AI_API_KEY:"synthetic-never-sent",SAITU_V7_EFFORT_POLICY:JSON.stringify({version:"saitu.effort-policy.v1",rank:"low",explain:"low",review:"low"})});delete process.env.SAITU_V7_EFFORT_POLICY_SHA256;
  database.pool=undefined;vi.mocked(readUserUnboundedExecutionAuthorizationV7).mockImplementation(async()=>({runId:"synthetic-verified-new-grant",mainRunId:"main",phase:"calibration",policySha256:"a".repeat(64),effortPolicySha256:"b".repeat(64),conditionSha256:"c".repeat(64)}));
  resetModelCallGovernorForTests();vi.mocked(reserveAiSpend).mockClear();vi.useFakeTimers();vi.setSystemTime(1_000_000);vi.spyOn(console,"info").mockImplementation(()=>undefined);vi.spyOn(console,"warn").mockImplementation(()=>undefined);});
afterEach(()=>{database.pool=undefined;resetModelCallGovernorForTests();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();process.env={...original};});
describe("actual provider feedback without retrying the failed request",()=>{
  it("records a real 429 Retry-After and delays only the next independent dispatch and worker acquisition",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(new Response('{}',{status:429,headers:{"retry-after":"2"}})).mockImplementation(async()=>successful()));
    expect(await requestAiJson("original",options)).toMatchObject({ok:false,reason:"rate_limited",attempts:1});expect(fetch).toHaveBeenCalledTimes(1);expect(providerCapacityReadyForNewWorkV7()).toBe(false);
    expect(getModelCallGovernorConfigurationSnapshot()).toMatchObject({providerBackpressure:{httpStatus:429,source:"retry-after",delayMs:2000,untilEpochMs:1_002_000,scope:"process"}});
    const next=requestAiJson("new independent request",options);await vi.advanceTimersByTimeAsync(1999);expect(fetch).toHaveBeenCalledTimes(1);expect(reserveAiSpend).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect((await next).ok).toBe(true);expect(fetch).toHaveBeenCalledTimes(2);expect(providerCapacityReadyForNewWorkV7()).toBe(true);
  });
  it("uses an explicit finite fallback for missing Retry-After and never loops over the original 429",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response('{}',{status:429})));
    expect(await requestAiJson("first",options)).toMatchObject({ok:false,attempts:1});expect(getModelCallGovernorConfigurationSnapshot()).toMatchObject({providerBackpressure:{source:"bounded-fallback",delayMs:1000}});
    const next=requestAiJson("second independent request",options);await vi.advanceTimersByTimeAsync(999);expect(fetch).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);
    expect(await next).toMatchObject({ok:false,attempts:1});expect(fetch).toHaveBeenCalledTimes(2);expect(getModelCallGovernorConfigurationSnapshot()).toMatchObject({providerBackpressure:{source:"bounded-fallback",delayMs:2000}});
  });
  it("stops a later request at its own remaining deadline without spending or dispatching it",async()=>{
    recordModelCallCapacityFeedbackV7(429,10000);vi.stubGlobal("fetch",vi.fn(async()=>successful()));
    const deadline=Date.now()+7000,pending=requestAiJson("deadline-bound new request",{...options,deadlineEpochMs:deadline});
    await vi.advanceTimersByTimeAsync(2000);expect(await pending).toMatchObject({ok:false,reason:"capacity_exhausted",upstreamAttempted:false});
    expect(Date.now()).toBeLessThanOrEqual(deadline);expect(fetch).not.toHaveBeenCalled();expect(reserveAiSpend).not.toHaveBeenCalled();
  });
  it("aborts cooldown waiting and leaves unknown network outcomes as a single paid attempt",async()=>{
    recordModelCallCapacityFeedbackV7(429,2000);const controller=new AbortController();vi.stubGlobal("fetch",vi.fn(async()=>successful()));
    const pending=requestAiJson("cancelled independent request",{...options,signal:controller.signal});await vi.advanceTimersByTimeAsync(0);controller.abort();
    expect(await pending).toMatchObject({ok:false,upstreamAttempted:false});expect(fetch).not.toHaveBeenCalled();
    resetModelCallGovernorForTests();vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("synthetic_disconnect");}));
    expect(await requestAiJson("network unknown",options)).toMatchObject({ok:false,reason:"network_error",attempts:1,upstreamAttempted:true});expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves the historical finite policy instead of applying a new feedback mode to old runs",()=>{
    process.env.SAITU_AI_EXECUTION_MODE="finite";recordModelCallCapacityFeedbackV7(429,2000);
    expect(providerCapacityReadyForNewWorkV7()).toBe(true);expect(getModelCallGovernorConfigurationSnapshot()).not.toHaveProperty("providerBackpressure");
  });
  it("bounds a blocked real-database authorization query by the request deadline and abort before any spend",async()=>{
    for(const abort of [false,true]){
      const release=vi.fn(),client={query:vi.fn(async(sql:string)=>sql==="synthetic-slow-authorization"?new Promise<never>(()=>{}):{rows:[],rowCount:0}),release};
      database.pool={connect:async()=>client};
      vi.mocked(readUserUnboundedExecutionAuthorizationV7).mockImplementation(async bounded=>{if(!bounded)throw new Error("authorization must use the bounded transaction client");await bounded.query("synthetic-slow-authorization");throw new Error("unreachable");});
      const controller=new AbortController(),deadline=Date.now()+7000;vi.stubGlobal("fetch",vi.fn(async()=>successful()));
      const pending=requestAiJson("blocked auth",{...options,deadlineEpochMs:deadline,signal:controller.signal});await vi.advanceTimersByTimeAsync(0);
      if(abort)controller.abort();else await vi.advanceTimersByTimeAsync(7000);
      expect(await pending).toMatchObject({ok:false,upstreamAttempted:false});expect(Date.now()).toBeLessThanOrEqual(deadline);expect(release).toHaveBeenCalledWith(true);
      expect(fetch).not.toHaveBeenCalled();expect(reserveAiSpend).not.toHaveBeenCalled();
    }
  });
});
