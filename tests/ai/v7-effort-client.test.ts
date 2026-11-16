import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("@/lib/ai/spend-ledger",async importOriginal=>({
  ...await importOriginal<typeof import("@/lib/ai/spend-ledger")>(),
  reserveAiSpend:vi.fn(async()=>({ok:true as const,reservation:{id:"synthetic-reservation",reservedMicros:0,settle:async()=>0}})),
}));
import {requestAiJson} from "@/lib/ai/ai-client";
import {reserveAiSpend} from "@/lib/ai/spend-ledger";
import {resetModelCallGovernorForTests} from "@/lib/ai/model-call-governor";
import {effortPolicySha256,parseEffortPolicy} from "@/lib/ai/effort-policy.mjs";
import {withDecisionEffortPolicy} from "@/lib/ai/effort-context";

const original={...process.env};
const policy=parseEffortPolicy({version:"saitu.effort-policy.v1",rank:"low",explain:"high",review:"low"});
let bodies:Record<string,unknown>[];
beforeEach(()=>{
  process.env={...original};delete process.env.DATABASE_URL;
  Object.assign(process.env,{AI_PROVIDER:"deepseek",AI_API_KEY:"synthetic-never-sent",AI_SPEND_AUTHORIZED_EFFORT:"stage",
    SAITU_V7_EFFORT_POLICY:JSON.stringify(policy),SAITU_V7_EFFORT_POLICY_SHA256:effortPolicySha256(policy)});
  bodies=[];vi.mocked(reserveAiSpend).mockClear();
  vi.stubGlobal("fetch",vi.fn(async(_url:unknown,options:RequestInit)=>{
    bodies.push(JSON.parse(String(options.body)));
    return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,prompt_cache_hit_tokens:0}}));
  }));
  vi.spyOn(console,"info").mockImplementation(()=>undefined);
});
afterEach(()=>{resetModelCallGovernorForTests();process.env={...original};vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("versioned resolved product effort with synthetic transport",()=>{
  it("sends the exact per-stage policy and records its hash in spend metadata",async()=>{
    for(const stage of ["rank","explain","review"]){
      expect((await requestAiJson("synthetic",{operation:`competition_v7_${stage}`})).ok).toBe(true);
    }
    expect(bodies.map(body=>body.reasoning_effort)).toEqual(["low","high","low"]);
    expect(bodies.every(body=>(body.thinking as {type:string}).type==="enabled")).toBe(true);
    expect(vi.mocked(reserveAiSpend).mock.calls.map(([input])=>input.effortPolicySha256)).toEqual(Array(3).fill(effortPolicySha256(policy)));
  });
  it("keeps chat, extraction, chat review and normalization high",async()=>{
    for(const operation of ["competition_v7_chat","competition_v7_extract","competition_v7_chat_review","competition_normalize"]){
      expect((await requestAiJson("synthetic",{operation})).ok).toBe(true);
    }
    expect(bodies.map(body=>body.reasoning_effort)).toEqual(["high","high","high","high"]);
  });
  it("maps only the fixed release preflight recommend operation to rank",async()=>{
    expect((await requestAiJson("synthetic",{operation:"competition_recommend"})).ok).toBe(true);
    expect(bodies[0].reasoning_effort).toBe("low");
    expect(await requestAiJson("synthetic",{operation:"arbitrary_operation"})).toMatchObject({ok:false,reason:"spend_configuration_invalid",upstreamAttempted:false});
    expect(bodies).toHaveLength(1);
  });
  it("rejects an explicit caller mismatch before spend or fetch",async()=>{
    expect(await requestAiJson("synthetic",{operation:"competition_v7_rank",reasoningEffort:"high"})).toMatchObject({ok:false,upstreamAttempted:false,reason:"spend_configuration_invalid"});
    expect(bodies).toHaveLength(0);expect(reserveAiSpend).not.toHaveBeenCalled();
  });
  it("freezes a run scope across environment edits and parallel calls",async()=>{
    await withDecisionEffortPolicy(policy,async()=>{
      const changed={...policy,rank:"high"};process.env.SAITU_V7_EFFORT_POLICY=JSON.stringify(changed);
      process.env.SAITU_V7_EFFORT_POLICY_SHA256=effortPolicySha256(parseEffortPolicy(changed));
      const results=await Promise.all([requestAiJson("one",{operation:"competition_v7_rank"}),requestAiJson("two",{operation:"competition_v7_review"})]);
      expect(results.every(result=>result.ok)).toBe(true);
    });
    expect(bodies.map(body=>body.reasoning_effort)).toEqual(["low","low"]);
  });
  it("fails closed on a configured policy fingerprint mismatch",async()=>{
    process.env.SAITU_V7_EFFORT_POLICY_SHA256="0".repeat(64);
    expect(await requestAiJson("synthetic",{operation:"competition_v7_explain"})).toMatchObject({ok:false,reason:"spend_configuration_invalid",upstreamAttempted:false});
    expect(bodies).toHaveLength(0);expect(reserveAiSpend).not.toHaveBeenCalled();
  });
  it("preserves the legacy max default and explicit legacy experiment override",async()=>{
    delete process.env.AI_SPEND_AUTHORIZED_EFFORT;delete process.env.AI_SPEND_RUN_ID;
    await requestAiJson("legacy",{reasoningEffort:"low"});
    await requestAiJson("legacy experiment",{reasoningEffort:"low",evaluationRun:true});
    expect(bodies.map(body=>body.reasoning_effort)).toEqual(["max","low"]);
  });
});
