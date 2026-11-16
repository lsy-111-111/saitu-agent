import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as recommend } from "@/app/api/ai/competition-recommend/route";
import { createCompetitionConversationToken } from "@/lib/ai/competition-conversation-token";
import { applyProfileMutations, createStudentProfile } from "@/lib/competitions/v6/profile";
import { POST } from "@/app/api/ai/competition-chat/route";
import { buildRuleDecisionReport } from "@/lib/competitions/v6/engine";
import { initializeDecisionState, readDecisionState, verifyDecisionToken, resetDecisionStatesForTests, compareAndSwapDecisionState } from "@/lib/competitions/v6/decision-state";
import { decisionChatReplySchema } from "@/lib/competitions/v6/chat-contracts";
import { resetRateLimitStateForTests } from "@/lib/security/rate-limit";
import { getDecisionCatalog } from "@/lib/competitions/v6/catalog";
import { student } from "./decision-fixtures";

const environment={...process.env};
beforeEach(()=>{
  Object.assign(process.env,{FEATURE_AI:"1",FEATURE_COMPETITION_RECOMMENDER:"1",AI_PROVIDER:"mock",AI_TEST_MODE:"1",ALLOW_AI_MOCK:"1",AI_CONSENT_VERSION:"chat-tests",AI_CONVERSATION_SIGNING_SECRET:"chat-tests-a-long-secret-at-least-thirty-two-characters",SAITU_DECISION_STRATEGY:"rules"});
  delete process.env.DATABASE_URL;delete process.env.AI_API_KEY;
  resetRateLimitStateForTests(); resetDecisionStatesForTests();vi.spyOn(console,"info").mockImplementation(()=>undefined);
});
afterEach(()=>{process.env={...environment};vi.restoreAllMocks();});
async function initial(){
  const legacy=student({decisionContext:{budget:{range:"100-500",maximumYuan:300,scope:"personal"}}});
  return initializeDecisionState({sessionId:"chat-test-session",expiresAt:Date.now()+1_800_000,legacy,report:buildRuleDecisionReport(legacy)});
}
function request(body:unknown){return new Request("http://localhost/api/ai/competition-chat",{method:"POST",headers:{"content-type":"application/json","x-forwarded-for":"198.51.100.241"},body:JSON.stringify(body)});}
function payload(token:string,revision:string,id:string,action:unknown){return {decisionToken:token,expectedRevision:revision,requestId:id,aiConsent:{accepted:true,version:"chat-tests"},action};}
describe("report conversation confirmation and concurrency",()=>{
  it("proposes a natural-language correction without mutation, confirms and recalculates, then replays exactly",async()=>{
    const start=await initial();const revision=start.report.profile.revision;
    const first=payload(start.decisionToken,revision,"request-budget-propose",{type:"message",text:"我的个人预算改为0元"});
    const proposed=decisionChatReplySchema.parse(await (await POST(request(first))).json());
    expect(proposed.kind).toBe("update_proposal");expect(proposed.profileRevision).toBe(revision);
    const stateBefore=await readDecisionState(verifyDecisionToken(start.decisionToken)!.id);
    expect(stateBefore?.report.profile.facts.find(f=>f.field==="budget.maximumYuan")?.value).toBe(300);
    const confirm=payload(proposed.decisionToken,revision,"request-budget-confirm",{type:"confirm_update",proposalId:proposed.proposal!.id});
    const response=await POST(request(confirm));expect(response.status).toBe(200);
    const changed=decisionChatReplySchema.parse(await response.json());
    expect(changed.kind).toBe("report_updated");expect(changed.profileRevision).not.toBe(revision);
    expect(changed.report?.profile.facts.find(f=>f.field==="budget.maximumYuan")?.value).toBe(0);
    expect(changed.report?.profile.updates?.[0].originalText).toBe("我的个人预算改为0元");
    expect(await (await POST(request(confirm))).json()).toEqual(changed);
    const stale=await POST(request(payload(start.decisionToken,revision,"request-stale-message",{type:"message",text:"为什么推荐"})));
    expect(stale.status).toBe(409);
  });
  it("cancel keeps the same profile and rejects missing consent, forged tokens and arbitrary profiles",async()=>{
    const start=await initial(), revision=start.report.profile.revision;
    const body=payload(start.decisionToken,revision,"request-cancel-propose",{type:"message",text:"我每周只能投入3小时"});
    const proposed=decisionChatReplySchema.parse(await(await POST(request(body))).json());
    const cancelled=decisionChatReplySchema.parse(await(await POST(request(payload(proposed.decisionToken,revision,"request-cancel-confirm",{type:"reject_update",proposalId:proposed.proposal!.id})))).json());
    expect(cancelled.profileRevision).toBe(revision);
    expect((await POST(request({...body,aiConsent:{accepted:false,version:"chat-tests"}}))).status).toBe(403);
    expect((await POST(request({...body,decisionToken:start.decisionToken+"x"}))).status).toBe(401);
    expect((await POST(request({...body,profile:student()}))).status).toBe(400);
  });
  it("answers comparisons from current report and serializes concurrent state changes with CAS",async()=>{
    const start=await initial(), token=verifyDecisionToken(start.decisionToken)!;
    const reply=decisionChatReplySchema.parse(await(await POST(request(payload(start.decisionToken,start.report.profile.revision,"request-comparison-test",{type:"message",text:"比较这两项的区别"})))).json());
    if(start.report.recommendations.length>=2)expect(reply.kind).toBe("comparison");
    const state=(await readDecisionState(token.id))!;
    const next={...state,generation:state.generation+1};
    const results=await Promise.all([compareAndSwapDecisionState(next,state.generation),compareAndSwapDecisionState(next,state.generation)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("does not store personal identifiers or allow one request ID to mutate a different action",async()=>{
    const start=await initial(), revision=start.report.profile.revision;
    const body=payload(start.decisionToken,revision,"request-id-protection",{type:"message",text:"预算改为100元"});
    const first=decisionChatReplySchema.parse(await(await POST(request(body))).json());
    const reused=await POST(request({...body,decisionToken:first.decisionToken,action:{type:"message",text:"预算改为0元"}}));
    expect(reused.status).toBe(409);
  });
});


describe("canonical state across questionnaire and dynamic questions",()=>{
  it("re-signing an old questionnaire preserves chat additions, CAS generation and exact retry",async()=>{
    const legacy=student({decisionContext:{noviceTaskPreferences:[{task:"build-tool",preference:"avoid"}]}});
    const profile=applyProfileMutations(createStudentProfile(legacy),[{operation:"set",field:"eligibility.age",value:19,targetFactIds:[],quote:"我19岁"}],{answerId:"chat-added-age",text:"我19岁",at:new Date().toISOString()},legacy);
    const start=await initializeDecisionState({sessionId:"existing-canonical-session",expiresAt:Date.now()+1_800_000,legacy,report:buildRuleDecisionReport(legacy,{profile})});
    const fresh=student({weeklyCommitment:"over-10",confirmedFields:["stage","weeklyCommitment"]});
    const token=createCompetitionConversationToken({profile:fresh,rawAnswerContext:[{fieldId:"stage",selectedValues:[fresh.stage]},{fieldId:"weeklyCommitment",selectedValues:[fresh.weeklyCommitment]}],transcript:[],pendingQuestion:null,completed:true});
    const body={aiConsent:{accepted:true,version:"chat-tests"},reportVersion:"competition-recommendation.v6",conversationToken:token,decisionEdit:{decisionToken:start.decisionToken,expectedRevision:profile.revision,changedFields:["weeklyCommitment"]}};
    const response=await recommend(request(body));expect(response.status).toBe(200);
    const result=await response.json();
    expect(result.report.profile.profileId).toBe(profile.profileId);
    expect(result.report.profile.facts.find((f:{field:string})=>f.field==="eligibility.age")).toEqual(profile.facts.find(f=>f.field==="eligibility.age"));
    expect(result.report.profile.facts.find((f:{field:string})=>f.field==="noviceTask")).toEqual(profile.facts.find(f=>f.field==="noviceTask"));
    expect(result.report.profile.facts.find((f:{field:string})=>f.field==="weeklyCommitment").value).toBe("over-10");
    expect(verifyDecisionToken(result.decisionToken)).toMatchObject({id:verifyDecisionToken(start.decisionToken)!.id,generation:1,sessionId:"existing-canonical-session"});
    expect(await(await recommend(request(body))).json()).toEqual(result);
    const stale={...body,decisionEdit:{...body.decisionEdit,changedFields:["teamStatus"]}};
    expect((await recommend(request(stale))).status).toBe(409);
    const staleChat=await POST(request(payload(start.decisionToken,profile.revision,"stale-questionnaire-chat",{type:"message",text:"为什么"})));
    expect(staleChat.status).toBe(409);
  });
  it.each(["skipped","unknown"] as const)("remembers %s without inventing facts or looping after a confirmed change",async disposition=>{
    const start=await initial(), question=start.report.usefulQuestions?.[0];expect(question).toBeDefined();
    const body=payload(start.decisionToken,start.report.profile.revision,`request-question-${disposition}`,{type:"skip_question",questionId:question!.id,disposition});
    const response=await POST(request(body));expect(response.status).toBe(200);
    const skipped=decisionChatReplySchema.parse(await response.json());
    expect(skipped.report!.profile).toEqual(start.report.profile);
    expect(skipped.report?.usefulQuestions?.some(q=>q.id===question!.id||q.field===question!.field)).toBe(false);
    expect(await(await POST(request(body))).json()).toEqual(skipped);
    const proposal=decisionChatReplySchema.parse(await(await POST(request(payload(skipped.decisionToken,skipped.profileRevision,`request-update-after-${disposition}`,{type:"message",text:"预算改为100元"})))).json());
    const changed=decisionChatReplySchema.parse(await(await POST(request(payload(proposal.decisionToken,proposal.profileRevision,`request-confirm-after-${disposition}`,{type:"confirm_update",proposalId:proposal.proposal!.id})))).json());
    expect(changed.report?.usefulQuestions?.some(q=>q.id===question!.id||q.field===question!.field)).toBe(false);
    expect(changed.report?.profile.facts.some(f=>f.field===question!.field)).toBe(start.report.profile.facts.some(f=>f.field===question!.field));
    const state=(await readDecisionState(verifyDecisionToken(changed.decisionToken)!.id))!;
    expect(state.questionHistory).toEqual([expect.objectContaining({questionId:question!.id,field:question!.field,disposition})]);
  });
});

// Real publication gate; mock AI transport is the existing test environment only.
it("returns a catalog-conflict response for a saved pre-fix unpublished recommendation", async () => {
  const legacy=student(),report=buildRuleDecisionReport(legacy);
  const hidden=getDecisionCatalog().find(r=>r.seriesId==="asme-sme-manufacturing-design")!;
  report.recommendations[0].itemId=hidden.recordId;
  const start=await initializeDecisionState({sessionId:"publication-stale-chat",expiresAt:Date.now()+60000,legacy,report});
  const response=await POST(request(payload(start.decisionToken,report.profile.revision,"request-stale-publication",{type:"message",text:"核实这个任务",selectedItemIds:[hidden.recordId]})));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ok:false,error:"DECISION_CATALOG_CHANGED",message:expect.stringContaining("重新生成")});
});
