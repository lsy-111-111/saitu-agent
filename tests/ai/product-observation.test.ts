import {afterEach,describe,it,expect,vi} from "vitest";
import {z} from "zod";
import {requestAiJson} from "@/lib/ai/ai-client";
import {withProductObservation,withRecommendationAccountingTrace,emitProductObservation,type ProductObservation} from "@/lib/ai/product-observation";
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("request-scoped provider observation (synthetic transport, no paid calls)",()=>{
 it("binds concurrent request accounting without logging content or replacing an existing observer",async()=>{
  const log=vi.spyOn(console,"info").mockImplementation(()=>undefined),seen:ProductObservation[]=[];
  await Promise.all(["request-a","request-b"].map(requestId=>withProductObservation({observer:event=>{seen.push(event);}},()=>withRecommendationAccountingTrace(requestId,async()=>{
   await Promise.resolve();
   emitProductObservation("ai_transport_dispatch",{reservationId:`reservation-${requestId}`,model:"deepseek-flash",attempt:1,operation:"competition_recommend",prompt:"PRIVATE_PROMPT",apiKey:"PRIVATE_CREDENTIAL"});
   emitProductObservation("decision_state_read",{stateKey:"PRIVATE_STATE"});
  }))));
  const rows=log.mock.calls.map(call=>JSON.parse(String(call[0])));
  expect(rows.map(row=>[row.requestId,row.details.reservationId])).toEqual([["request-a","reservation-request-a"],["request-b","reservation-request-b"]]);
  expect(seen).toHaveLength(4);expect(rows).toHaveLength(2);
  expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_|prompt|apiKey|stateKey/);
 });
 it("keeps concurrent attempts isolated and cannot retry a successful call when an observer throws",async()=>{
  vi.stubEnv("AI_PROVIDER","deepseek");vi.stubEnv("AI_API_KEY","unit-key-never-sent");vi.stubEnv("DATABASE_URL","");vi.stubEnv("AI_SPEND_RUN_ID","");vi.stubEnv("RUN_DEEPSEEK_LIVE","");vi.stubEnv("RUN_DEEPSEEK_NORMALIZE_LIVE","");
  vi.spyOn(console,"info").mockImplementation(()=>undefined);
  const transport=vi.fn(async()=>new Response(JSON.stringify({id:"unit-provider-id",choices:[{message:{content:'{"value":true}'},finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:4,prompt_cache_hit_tokens:2}}),{status:200,headers:{"content-type":"application/json","x-request-id":"unit-provider-id"}}));vi.stubGlobal("fetch",transport);
  const a:ProductObservation[]=[],b:ProductObservation[]=[];
  const run=(events:ProductObservation[],operation:string,asyncFailure:boolean)=>withProductObservation({observer:e=>{events.push(e);if(asyncFailure)return Promise.reject(new Error("async_observer"));throw new Error("sync_observer");}},()=>requestAiJson("SENSITIVE_PROMPT_SENT_ONLY_TO_MOCK",{schema:z.object({value:z.boolean()}),operation,promptVersion:"unit",maxAttempts:2,maxTokens:32}));
  const results=await Promise.all([run(a,"unit-a",false),run(b,"unit-b",true)]);expect(results.every(r=>r.ok)).toBe(true);expect(transport).toHaveBeenCalledTimes(2);
  expect(a.filter(e=>e.type==="ai_attempt_result").map(e=>e.details.operation)).toEqual(["unit-a"]);expect(b.filter(e=>e.type==="ai_attempt_result").map(e=>e.details.operation)).toEqual(["unit-b"]);
  expect(a.find(e=>e.type==="ai_attempt_result")?.details).toMatchObject({providerRequestId:expect.stringMatching(/^ai_req_[a-f0-9]+$/),usage:{inputTokens:10,outputTokens:4,cachedInputTokens:2}});
  expect(JSON.stringify([a,b])).not.toMatch(/unit-key-never-sent|SENSITIVE_PROMPT|reasoning_content|Authorization/);
 });
 it("records only the actual provider policy and server stage binding from the dispatched body",async()=>{
  vi.stubEnv("AI_PROVIDER","deepseek");vi.stubEnv("AI_API_KEY","fixture-secret");vi.stubEnv("DATABASE_URL","");vi.stubEnv("AI_SPEND_RUN_ID","");
  const events:ProductObservation[]=[];
  let body:Record<string,unknown>={};
  vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{body=JSON.parse(init.body);return new Response('{"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]}');}));
  await withProductObservation({observer:event=>{events.push(event);}},()=>requestAiJson("fixture-sensitive",{diagnosticContext:{invocationId:"invocation-unit",stage:"verify",reviewId:"support-2"},maxAttempts:1}));
  const dispatch=events.find(event=>event.type==="ai_transport_dispatch")!.details;
  expect(dispatch).toMatchObject({model:body.model,thinkingType:(body.thinking as {type:string}).type,reasoningEffort:body.reasoning_effort,maxTokens:body.max_tokens,invocationId:"invocation-unit",stage:"verify",reviewId:"support-2"});
  expect(body).not.toHaveProperty("diagnosticContext");
  expect(JSON.stringify(dispatch)).not.toMatch(/fixture-secret|fixture-sensitive|messages/);
 });
});

describe("real requestAiJson transport fault boundary, native transport mocked",()=>{
 it.each(["timeout","aborted","retry_after_exhaustion"])("injects %s at fetch without a native network dispatch",async fault=>{
  const {withEvaluationTransportFault}=await import("@/lib/competitions/v6/evaluation-transport-fault");
  vi.stubEnv("AI_PROVIDER","deepseek");vi.stubEnv("AI_API_KEY","fixture-only-not-real");vi.stubEnv("DATABASE_URL","");vi.stubEnv("AI_SPEND_RUN_ID","");vi.stubEnv("RUN_DEEPSEEK_LIVE","");vi.stubEnv("RUN_DEEPSEEK_NORMALIZE_LIVE","");vi.spyOn(console,"warn").mockImplementation(()=>undefined);
  const native=vi.fn();vi.stubGlobal("fetch",native);const events:ProductObservation[]=[];
  const result=await withProductObservation({observer:e=>{events.push(e);}},()=>withEvaluationTransportFault({fault,at:"before_dispatch",allowedAttempts:1,maxAdditionalCalls:0,requestAiJsonBoundary:true},()=>requestAiJson("synthetic",{schema:z.object({value:z.boolean()}),operation:"fault-unit",maxAttempts:1,maxTokens:32})));
  expect(result.perturbedResult.ok).toBe(false);expect(result.mutationProof).toMatchObject({actualNetworkDispatches:0,boundaryAttempts:1});expect(native).not.toHaveBeenCalled();expect(events.some(e=>e.type==="transport_fault_injected")).toBe(true);expect(events.find(e=>e.type==="ai_attempt_result")?.details.usage).toBeNull();
 });
 it("discards an actual completed transport response before product parsing and preserves unknown usage",async()=>{
  const {withEvaluationTransportFault}=await import("@/lib/competitions/v6/evaluation-transport-fault");
  vi.stubEnv("AI_PROVIDER","deepseek");vi.stubEnv("AI_API_KEY","fixture-only-not-real");vi.stubEnv("DATABASE_URL","");vi.stubEnv("AI_SPEND_RUN_ID","");vi.spyOn(console,"warn").mockImplementation(()=>undefined);
  const native=vi.fn(async()=>new Response('{"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":99,"completion_tokens":99}}'));vi.stubGlobal("fetch",native);
  const result=await withEvaluationTransportFault({fault:"timeout",at:"after_dispatch_before_response",allowedAttempts:1,maxAdditionalCalls:1,requestAiJsonBoundary:true},()=>requestAiJson("synthetic",{schema:z.object({}),maxAttempts:1,maxTokens:32}));expect(native).toHaveBeenCalledTimes(1);expect(result.mutationProof).toMatchObject({actualNetworkDispatches:1,providerUsage:null,providerCharge:null});expect(result.perturbedResult).toMatchObject({ok:false,reason:"timeout"});
 });
});
