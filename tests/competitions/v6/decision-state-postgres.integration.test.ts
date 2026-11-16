import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import * as ai from "@/lib/ai/ai-client";
import { loadEnvConfig } from "@next/env";
import { getPool } from "@/lib/db/pool";
import { initializeDecisionState, readDecisionState, verifyDecisionToken, compareAndSwapDecisionState } from "@/lib/competitions/v6/decision-state";
import { buildRuleDecisionReport } from "@/lib/competitions/v6/engine";
import { POST } from "@/app/api/ai/competition-chat/route";
import { student } from "./decision-fixtures";

const integration=process.env.RUN_DECISION_STATE_INTEGRATION==="1"?describe:describe.skip;
integration("real local PostgreSQL decision state (mock AI only)",()=>{
  const original={...process.env};const ids:string[]=[];
  beforeAll(()=>{
    const mode=process.env.NODE_ENV;
    Object.assign(process.env,{NODE_ENV:"development"});
    loadEnvConfig(process.cwd(),true,{info:()=>undefined,error:()=>undefined},true);
    Object.assign(process.env,{NODE_ENV:mode});
    if(!process.env.DATABASE_URL)throw new Error("Local database configuration required");
    Object.assign(process.env,{FEATURE_AI:"1",FEATURE_COMPETITION_RECOMMENDER:"1",AI_PROVIDER:"mock",AI_TEST_MODE:"1",ALLOW_AI_MOCK:"1",AI_API_KEY:"",SAITU_DECISION_STRATEGY:"rules",AI_CONSENT_VERSION:"decision-postgres-integration",AI_CONVERSATION_SIGNING_SECRET:"integration-only-decision-secret-do-not-use-in-production"});
    vi.spyOn(console,"info").mockImplementation(()=>undefined);
  });
  afterAll(async()=>{
    // Runtime may expire its own fixture rows; the separately provisioned maintenance role deletes expired state.
    if(ids.length)await getPool().query("update competition_decision_states set expires_at=now()-interval '1 second' where state_key=any($1::text[])",[ids]);
    process.env={...original};vi.restoreAllMocks();
  });
  async function create(){
    const legacy=student({decisionContext:{budget:{range:"100-500",maximumYuan:300,scope:"personal"}}});
    const created=await initializeDecisionState({sessionId:`integration-${randomUUID()}`,expiresAt:Date.now()+120_000,legacy,report:buildRuleDecisionReport(legacy)});
    const token=verifyDecisionToken(created.decisionToken)!;ids.push(token.id);return {...created,token};
  }
  it("persists ciphertext, authenticates reads and permits only one competing generation",async()=>{
    const start=await create();
    const row=(await getPool().query("select ciphertext,iv,tag from competition_decision_states where state_key=$1",[start.token.id])).rows[0];
    expect(row.ciphertext.toString("utf8")).not.toContain("budget.maximumYuan");
    expect(row.iv.length).toBe(12);expect(row.tag.length).toBe(16);
    const state=(await readDecisionState(start.token.id))!;
    expect(state.report.profile.revision).toBe(start.report.profile.revision);
    const next={...state,generation:state.generation+1};
    const results=await Promise.all([compareAndSwapDecisionState(next,state.generation),compareAndSwapDecisionState(next,state.generation)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const corrupted=Buffer.from(row.ciphertext);corrupted[0]^=1;
    await getPool().query("update competition_decision_states set ciphertext=$2 where state_key=$1",[start.token.id,corrupted]);
    await expect(readDecisionState(start.token.id)).rejects.toThrow();
  });
  it("persists domain extraction only after confirmation and rejects a stale token",async()=>{
    const start=await create();
    const mocked=vi.spyOn(ai,"requestAiJson").mockResolvedValue({ok:true,data:{facts:[{field:"work.durationSeconds",value:120,state:"affirmed",evidenceLevel:"self_report",confirmed:true,sourceText:"作品长120秒"}],unknownFields:[]},model:"deepseek-flash",upstreamAttempted:true,attempts:1,finishReason:"stop",httpStatus:200,durationMs:1} as Awaited<ReturnType<typeof ai.requestAiJson>>);
    try {
      const send=(body:unknown)=>POST(new Request("http://localhost/api/ai/competition-chat",{method:"POST",headers:{"content-type":"application/json","x-forwarded-for":"198.51.100.248"},body:JSON.stringify(body)}));
      const base={decisionToken:start.decisionToken,expectedRevision:start.report.profile.revision,aiConsent:{accepted:true,version:"decision-postgres-integration"}};
      const response=await send({...base,requestId:`extract-${randomUUID()}`,action:{type:"extract_profile",utterance:"作品长120秒",requestedFields:["work.durationSeconds"]}});
      expect(response.status).toBe(200);const proposal=await response.json();
      expect(proposal.extractedFacts[0].confirmed).toBe(false);
      expect((await readDecisionState(start.token.id))!.report.profile.facts.some(f=>f.field==="work.durationSeconds")).toBe(false);
      const confirm={...base,decisionToken:proposal.decisionToken,requestId:`confirm-${randomUUID()}`,action:{type:"confirm_update",proposalId:proposal.proposal.id}};
      const committed=await send(confirm);expect(committed.status).toBe(200);const result=await committed.json();
      expect(result.report.profile.facts.find((f:{field:string})=>f.field==="work.durationSeconds")).toMatchObject({value:120,confirmed:true});
      const stale=await send({...base,requestId:`stale-${randomUUID()}`,action:{type:"message",text:"比较这两项"}});expect(stale.status).toBe(409);
      expect(await(await send(confirm)).json()).toEqual(result);expect(mocked).toHaveBeenCalledTimes(1);
    } finally {mocked.mockRestore();}
  });
  it("runs propose → confirm → exact replay through real persistent session transitions without a model call",async()=>{
    const start=await create();
    const send=async(body:unknown)=>POST(new Request("http://localhost/api/ai/competition-chat",{method:"POST",headers:{"content-type":"application/json","x-forwarded-for":"198.51.100.249"},body:JSON.stringify(body)}));
    const proposed=await send({decisionToken:start.decisionToken,expectedRevision:start.report.profile.revision,requestId:`propose-${randomUUID()}`,aiConsent:{accepted:true,version:"decision-postgres-integration"},action:{type:"message",text:"我的预算改为100元"}});
    expect(proposed.status).toBe(200);const proposal=await proposed.json();expect(proposal.kind).toBe("update_proposal");
    const body={decisionToken:proposal.decisionToken,expectedRevision:start.report.profile.revision,requestId:`confirm-${randomUUID()}`,aiConsent:{accepted:true,version:"decision-postgres-integration"},action:{type:"confirm_update",proposalId:proposal.proposal.id}};
    const response=await send(body);expect(response.status).toBe(200);const changed=await response.json();
    expect(changed.kind).toBe("report_updated");expect(changed.report.trace.callCount).toBe(0);
    expect(changed.report.profile.facts.find((f:{field:string})=>f.field==="budget.maximumYuan").value).toBe(100);
    const replay=await send(body);expect(replay.headers.get("x-idempotent-replay")).toBe("true");expect(await replay.json()).toEqual(changed);
  });
});
