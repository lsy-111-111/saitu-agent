import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
import * as ai from "@/lib/ai/ai-client";
import { draftDecisionChat } from "@/lib/competitions/v6/chat";
import { applyProfileMutations,createStudentProfile } from "@/lib/competitions/v6/profile";
import { buildRuleDecisionReport } from "@/lib/competitions/v6/engine";
import type { DecisionState } from "@/lib/competitions/v6/decision-state";
import { student } from "./decision-fixtures";
const env={...process.env};
beforeEach(()=>{Object.assign(process.env,{AI_PROVIDER:"deepseek",AI_API_KEY:"unit-test-no-network",AI_TEST_MODE:"0",ALLOW_AI_MOCK:"0"});});
afterEach(()=>{process.env={...env};vi.restoreAllMocks();});
describe("chat prompt only uses current profile revision",()=>{
  it("does not send withdrawn original text from either profile audit or previous-version history",async()=>{
    const withdrawn="撤销专用原文标记：清洗旧数据";
    const legacy=student({decisionContext:{experiences:[{id:"e",task:withdrawn,contribution:"independent",completion:"delivered",challenge:"",confirmed:true}]}});
    const before=createStudentProfile(legacy), task=before.facts.find(f=>f.field==="experience.1.task")!;
    const profile=applyProfileMutations(before,[{operation:"retract",field:task.field,targetFactIds:[task.id],quote:withdrawn}],{answerId:"retract-test",text:withdrawn,at:new Date().toISOString()},legacy);
    expect(JSON.stringify(profile.updates)).toContain(withdrawn);
    // Use the real approved catalog so publication/version rejection cannot
    // short-circuit the model prompt isolation assertion below.
    const state:DecisionState={id:"test",sessionId:"test",generation:1,expiresAt:Date.now()+60_000,legacy,report:buildRuleDecisionReport(legacy,{profile}),proposal:null,historyRevision:before.revision,history:[{role:"user",text:withdrawn}]};
    expect(state.report.recommendations.length).toBeGreaterThan(0);
    const intercepted=vi.spyOn(ai,"requestAiJson").mockResolvedValue({ok:false,reason:"timeout",upstreamAttempted:false,model:"deepseek-flash",attempts:0});
    await draftDecisionChat(state,"这项任务有什么准备建议",[]);
    expect(intercepted).toHaveBeenCalledTimes(1);
    const [prompt,options]=intercepted.mock.calls[0];
    expect(prompt).not.toContain(withdrawn);
    expect(JSON.parse(prompt).history).toEqual([]);
    expect(options).toMatchObject({maxTokens:8192,promptVersion:expect.stringContaining(ai.getAiConfigurationFingerprint())});
  });
  it("shows the model's short answer only after an independent check of its exact cited source",async()=>{
    const legacy=student(), state:DecisionState={id:"test",sessionId:"test",generation:1,expiresAt:Date.now()+60_000,legacy,report:buildRuleDecisionReport(legacy),proposal:null,history:[]};
    const item=state.report.recommendations[0];
    const call=vi.spyOn(ai,"requestAiJson").mockImplementation(async(prompt,options)=>{
      const input=JSON.parse(prompt);
      if (input.anchors) {
        const fact=input.anchors.find((row:{basis:string;text:string})=>row.basis==="official" && row.text);
        expect(fact).toBeDefined();
        const wire={anchor:fact.anchor,text:fact.text,mode:"explain"};
        const result=options!.schema!.safeParse(wire);
        if (!result.success) throw new Error("bad fixture");
        return {ok:true,data:result.data,model:"deepseek-flash",attempts:1,upstreamAttempted:true,httpStatus:200,finishReason:"stop",durationMs:1};
      }
      expect(input.competitionFacts).toHaveLength(1);
      expect(input.competitionFacts[0].id).toBe(input.claims[0].competitionFactIds[0]);
      expect(input.question).toContain("准备");
      return {ok:true,data:{supported:true,reason:"原文支持"},model:"deepseek-flash",attempts:1,upstreamAttempted:true,httpStatus:200,finishReason:"stop",durationMs:1};
    });
    const reply=await draftDecisionChat(state,"我该怎么准备？",[item.itemId]);
    expect(call).toHaveBeenCalledTimes(2);
    expect(reply.modelFallback).toBe(false);
    expect(reply.claims).toHaveLength(1);
    expect(item.evidenceFacts.some(fact=>fact.id===reply.claims[0].competitionFactIds[0])).toBe(true);
  });

  it("treats a student's limited contribution inside a question as evidence, including if the model proposes an edit",async()=>{
    const legacy=student({decisionContext:{experiences:[{id:"e",task:"整理问卷",contribution:"assisted",completion:"delivered",challenge:"",confirmed:true}]}});
    const state:DecisionState={id:"question",sessionId:"test",generation:1,expiresAt:Date.now()+60000,legacy,report:buildRuleDecisionReport(legacy),proposal:null,history:[]};
    const call=vi.spyOn(ai,"requestAiJson").mockResolvedValue({ok:true,data:{intent:"update",message:"待确认",itemIds:[],claims:[],mutations:[]},model:"deepseek-flash",attempts:1,upstreamAttempted:true,httpStatus:200,finishReason:"stop",durationMs:1});
    const answer=await draftDecisionChat(state,"第一项可以从哪件小任务开始？我只有协助整理问卷的经历。",[]);
    expect(call).toHaveBeenCalledTimes(1);expect(answer.kind).toBe("answer");expect(answer.proposal).toBeUndefined();
    const edit=await draftDecisionChat(state,"请把我的个人预算改成 50 元，可以重算吗？",[]);
    expect(edit.kind).toBe("update_proposal");expect(call).toHaveBeenCalledTimes(1);
  });

});
