import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const control=vi.hoisted(()=>({authorize:vi.fn(),permit:vi.fn()}));
vi.mock("@/lib/ai/spend-ledger",async importOriginal=>({
  ...await importOriginal<typeof import("@/lib/ai/spend-ledger")>(),
  reserveAiSpend:vi.fn(async()=>({ok:true as const,reservation:{id:"synthetic-non-thinking-reservation",reservedMicros:0,settle:async()=>0}})),
}));
vi.mock("@/lib/ai/model-call-governor",async importOriginal=>({
  ...await importOriginal<typeof import("@/lib/ai/model-call-governor")>(),
  readUserUnboundedAuthorizationBeforeV7:control.authorize,acquireModelCallPermit:control.permit,
}));
import {getAiConfigurationFingerprint,requestAiJson} from "@/lib/ai/ai-client";
import {reserveAiSpend} from "@/lib/ai/spend-ledger";
import {DEFAULT_EFFORT_POLICY,RANK_NON_THINKING_EFFORT_POLICY,effortPolicySha256} from "@/lib/ai/effort-policy.mjs";
import {emitProductObservation,withProductObservation,withRecommendationAccountingTrace,type ProductObservation} from "@/lib/ai/product-observation";

const original={...process.env};
let bodies:Record<string,unknown>[];
beforeEach(()=>{
  process.env={...original};delete process.env.DATABASE_URL;
  Object.assign(process.env,{NODE_ENV:"test",AI_PROVIDER:"deepseek",AI_API_KEY:"synthetic-non-thinking-secret",AI_MODEL:"deepseek-flash",SAITU_AI_EXECUTION_MODE:"user-unbounded",AI_SPEND_AUTHORIZED_EFFORT:"stage",
    SAITU_V7_EFFORT_POLICY:JSON.stringify(RANK_NON_THINKING_EFFORT_POLICY),SAITU_V7_EFFORT_POLICY_SHA256:effortPolicySha256(RANK_NON_THINKING_EFFORT_POLICY)});
  control.authorize.mockReset().mockResolvedValue({runId:"synthetic-authorized-v2"});control.permit.mockReset().mockResolvedValue({ok:true,permit:{release:vi.fn()}});
  vi.mocked(reserveAiSpend).mockClear();bodies=[];
  vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init:RequestInit)=>{
    bodies.push(JSON.parse(String(init.body)));return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:4,prompt_cache_hit_tokens:0}}));
  }));
  vi.spyOn(console,"info").mockImplementation(()=>undefined);vi.spyOn(console,"warn").mockImplementation(()=>undefined);
});
afterEach(()=>{process.env={...original};vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("authorised rank-only non-thinking real HTTP serializer with synthetic transport",()=>{
  it("sends disabled, actual zero temperature and top_p one, with no wire reasoning effort",async()=>{
    const events:ProductObservation[]=[];
    const result=await withProductObservation({observer:event=>{events.push(event);}},()=>withRecommendationAccountingTrace("v2-synthetic",()=>
      requestAiJson("PRIVATE_SYNTHETIC_PROMPT",{operation:"competition_v7_rank",model:"deepseek-flash",thinking:"disabled",reasoningEffort:"low",temperature:0,topP:1,maxTokens:32,maxAttempts:1})));
    expect(result.ok).toBe(true);expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({model:"deepseek-flash",thinking:{type:"disabled"},temperature:0,top_p:1,max_tokens:32,response_format:{type:"json_object"}});
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");expect(bodies[0]).not.toHaveProperty("policyReasoningEffort");
    expect(reserveAiSpend).toHaveBeenCalledWith(expect.objectContaining({effort:"low",operation:"competition_v7_rank",effortPolicySha256:effortPolicySha256(RANK_NON_THINKING_EFFORT_POLICY)}));
    expect(control.authorize.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(reserveAiSpend).mock.invocationCallOrder[0]);
    const dispatch=events.find(event=>event.type==="ai_transport_dispatch")!.details;
    expect(dispatch).toMatchObject({thinkingType:"disabled",policyReasoningEffort:"low",wireReasoningEffort:null,temperature:0,topP:1});expect(dispatch).not.toHaveProperty("reasoningEffort");
    const publicRows=vi.mocked(console.info).mock.calls.map(row=>String(row[0]));
    expect(publicRows.join("\n")).toContain('"wireReasoningEffort":null');expect(publicRows.join("\n")).not.toMatch(/PRIVATE_SYNTHETIC_PROMPT|synthetic-non-thinking-secret/);
    expect(getAiConfigurationFingerprint()).toContain("rank-thinking-disabled:temperature-0");
  });
  it("uses exact frozen settings even when rank caller leaves optional sampling unset",async()=>{
    expect((await requestAiJson("Synthetic",{operation:"competition_v7_rank",maxTokens:32})).ok).toBe(true);
    expect(bodies[0]).toMatchObject({thinking:{type:"disabled"},temperature:0,top_p:1});expect(bodies[0]).not.toHaveProperty("reasoning_effort");
  });
  it("retains enabled low explanations/reviews and enabled high profile/chat operations",async()=>{
    const operations=["competition_v7_explain","competition_v7_review","competition_v7_extract","competition_v7_chat","competition_v7_chat_review","competition_normalize","competition_recommend"];
    for(const operation of operations)expect((await requestAiJson("Synthetic",{operation,maxTokens:32,temperature:0})).ok).toBe(true);
    expect(bodies.map(body=>body.reasoning_effort)).toEqual(["low","low","high","high","high","high","low"]);
    expect(bodies.every(body=>(body.thinking as {type:string}).type==="enabled"&&!Object.hasOwn(body,"temperature")&&!Object.hasOwn(body,"top_p"))).toBe(true);
    expect(control.authorize).not.toHaveBeenCalled();
  });
  it.each([
    {operation:"competition_v7_rank",thinking:"enabled" as const},
    {operation:"competition_v7_rank",temperature:0.1},
    {operation:"competition_v7_rank",topP:0.95},
    {operation:"competition_v7_rank",reasoningEffort:"high" as const},
    {operation:"competition_v7_rank",model:"another-model"},
    {operation:"competition_v7_rank",maxAttempts:2 as const},
    ...["competition_v7_explain","competition_v7_review","competition_v7_extract","competition_v7_chat","competition_v7_chat_review","competition_normalize","competition_recommend","arbitrary_operation"].map(operation=>({operation,thinking:"disabled" as const})),
  ])("rejects incompatible operation/settings before authorization, reservation or HTTP: %j",async options=>{
    expect(await requestAiJson("Synthetic",options)).toMatchObject({ok:false,upstreamAttempted:false,reason:"spend_configuration_invalid"});
    expect(control.authorize).not.toHaveBeenCalled();expect(reserveAiSpend).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["finite","closed_or_old_grant"])("refuses %s authority before reservation or HTTP",async failure=>{
    if(failure==="finite")process.env.SAITU_AI_EXECUTION_MODE="finite";else control.authorize.mockRejectedValue(new Error("USER_UNBOUNDED_AUTHORIZATION_REQUIRED"));
    expect(await requestAiJson("Synthetic",{operation:"competition_v7_rank",model:"deepseek-flash",thinking:"disabled",temperature:0,topP:1})).toMatchObject({ok:false,reason:"spend_configuration_invalid",upstreamAttempted:false});
    expect(reserveAiSpend).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps cancellation a timeout while waiting for authority, with no reservation or HTTP",async()=>{
    const controller=new AbortController();controller.abort();control.authorize.mockRejectedValueOnce(new Error("aborted"));
    expect(await requestAiJson("Synthetic",{operation:"competition_v7_rank",thinking:"disabled",temperature:0,topP:1,signal:controller.signal})).toMatchObject({ok:false,reason:"timeout",upstreamAttempted:false});
    expect(reserveAiSpend).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps v1 fingerprints/wire unchanged and refuses its attempted disabled override",async()=>{
    Object.assign(process.env,{SAITU_V7_EFFORT_POLICY:JSON.stringify(DEFAULT_EFFORT_POLICY),SAITU_V7_EFFORT_POLICY_SHA256:effortPolicySha256(DEFAULT_EFFORT_POLICY)});
    expect(await requestAiJson("Synthetic",{operation:"competition_v7_rank",thinking:"disabled"})).toMatchObject({ok:false,upstreamAttempted:false});
    expect(reserveAiSpend).not.toHaveBeenCalled();expect((await requestAiJson("Synthetic",{operation:"competition_v7_rank",temperature:0,topP:0.95,maxTokens:32})).ok).toBe(true);
    expect(bodies[0]).toMatchObject({thinking:{type:"enabled"},reasoning_effort:"low",top_p:0.95});expect(bodies[0]).not.toHaveProperty("temperature");
    expect(getAiConfigurationFingerprint()).toBe(`deepseek-flash:thinking-enabled:stage:${effortPolicySha256(DEFAULT_EFFORT_POLICY)}:flash-policy.v2`);
  });
  it("only exposes the explicit policy/wire split in public metadata while dropping content",()=>{
    withRecommendationAccountingTrace("synthetic",()=>emitProductObservation("ai_transport_dispatch",{thinkingType:"disabled",policyReasoningEffort:"low",wireReasoningEffort:null,temperature:0,topP:1,prompt:"PRIVATE_PROMPT",apiKey:"PRIVATE_SECRET"}));
    const row=JSON.parse(String(vi.mocked(console.info).mock.calls[0][0]));
    expect(row.details).toEqual({thinkingType:"disabled",policyReasoningEffort:"low",wireReasoningEffort:null,temperature:0,topP:1});
  });
});
