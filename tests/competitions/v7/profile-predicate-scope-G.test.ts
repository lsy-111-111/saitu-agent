import { describe, expect, it } from "vitest";
import type { AiJsonResult } from "@/lib/ai/ai-client";
import { draftDecisionChatV7, extractSelfReportedFactsV7 } from "@/lib/competitions/v7/chat";
import { applyProfileMutationsV7, applySelfReportedFactsV7, createStudentProfileV7 } from "@/lib/competitions/v7/profile";
import type { DomainFact } from "@/lib/competitions/v6/domain-facts";
import { student } from "../v6/decision-fixtures";
const fact = (field: string, value: DomainFact["value"], sourceText: string, state: DomainFact["state"] = "affirmed"): DomainFact => ({ field, value, sourceText, state, evidenceLevel: "self_report", confirmed: false });
const source = (text: string, answerId: string) => ({ text, answerId, at: "2026-11-09T00:00:00+08:00" });
const success = (facts: DomainFact[], unresolvedAssertions: {sourceText:string;kind:"target"|"value"|"scope"}[]=[]): AiJsonResult<unknown> => ({ ok:true, data:{facts,unknownFields:[],unresolvedAssertions}, model:"offline-actual", upstreamAttempted:true, finishReason:"stop", attempts:1,httpStatus:200,durationMs:1 });

describe("open predicates do not replace an entire shared field", () => {
  it("keeps independent permission predicates and scopes even under the same provider field", () => {
    const legacy=student(), first="我获准借用三脚架。", second="我不能拆卸零件。";
    const initial=applySelfReportedFactsV7(createStudentProfileV7(legacy),{facts:[fact("asset.permission","借用三脚架",first)],unknownFields:[]},source(first,"grant"),legacy);
    const grant=initial.facts.find(row=>row.field==="asset.permission")!;
    const next=applySelfReportedFactsV7(initial,{facts:[fact("asset.permission","拆卸零件",second,"negated")],unknownFields:[]},source(second,"denial"),legacy);
    expect(next.facts.find(row=>row.id===grant.id)).toEqual(grant);
    expect(next.facts.filter(row=>row.field==="asset.permission")).toHaveLength(2);
    expect(next.facts.find(row=>row.state==="negated")?.supersedesFactIds).toEqual([]);
    expect(next.retractedFactIds).not.toContain(grant.id);
  });

  it("keeps different objects of the same verb; value placeholders are not predicate identity", () => {
    const legacy=student(), first="我获准借用三脚架。", second="我获准借用话筒。";
    const initial=applySelfReportedFactsV7(createStudentProfileV7(legacy),{facts:[fact("asset.permission",true,first)],unknownFields:[]},source(first,"tripod"),legacy);
    const next=applySelfReportedFactsV7(initial,{facts:[fact("asset.permission",true,second)],unknownFields:[]},source(second,"microphone"),legacy);
    expect(next.facts.filter(row=>row.field==="asset.permission")).toHaveLength(2);
  });

  it("replaces the same quoted predicate when only its polarity changes", () => {
    const legacy=student(), first="我可以拍照。", second="我不可以拍照。";
    const initial=applySelfReportedFactsV7(createStudentProfileV7(legacy),{facts:[fact("asset.permission",true,first)],unknownFields:[]},source(first,"photo-yes"),legacy);
    const old=initial.facts.find(row=>row.field==="asset.permission")!;
    const next=applySelfReportedFactsV7(initial,{facts:[fact("asset.permission",true,second,"negated")],unknownFields:[]},source(second,"photo-no"),legacy);
    expect(next.facts.filter(row=>row.field==="asset.permission")).toHaveLength(1);
    expect(next.facts.find(row=>row.field==="asset.permission")).toMatchObject({state:"negated",originalText:second,supersedesFactIds:[old.id]});
  });

  it("keeps explicit corrections and canonical budget/main-goal replacement", () => {
    const legacy=student(), text="每周3小时；主要目标是准备作品；储存范围是机房。";
    const initial=applySelfReportedFactsV7(createStudentProfileV7(legacy),{facts:[fact("weeklyHours",3,"每周3小时"),fact("primaryGoal","准备作品","主要目标是准备作品"),fact("resource.location","机房","储存范围是机房")],unknownFields:[]},source(text,"initial"),legacy);
    const changed="每周4小时；主要目标是完成实训；储存范围改为工作室。";
    const next=applySelfReportedFactsV7(initial,{facts:[fact("weeklyHours",4,"每周4小时"),fact("primaryGoal","完成实训","主要目标是完成实训"),fact("resource.location","工作室","储存范围改为工作室")],unknownFields:[]},source(changed,"changed"),legacy);
    expect(next.facts.filter(row=>row.field==="weeklyHours").map(row=>row.value)).toEqual([4]);
    expect(next.facts.filter(row=>row.field==="resource.location").map(row=>row.value)).toEqual(["工作室"]);
    expect(next.primaryGoal).toBe("完成实训");
  });

  it("gives only the correcting fact the superseded IDs when another predicate is added in that same turn", () => {
    const legacy=student(), text="已有资源为甲设备。";
    const initial=applySelfReportedFactsV7(createStudentProfileV7(legacy),{facts:[fact("asset.condition","甲设备",text)],unknownFields:[]},source(text,"old-equipment"),legacy);
    const old=initial.facts.find(row=>row.field==="asset.condition")!;
    const changed="已有资源改为乙设备；另获准借用工具。";
    const next=applySelfReportedFactsV7(initial,{facts:[fact("asset.condition","乙设备","已有资源改为乙设备"),fact("asset.condition","借用工具","另获准借用工具")],unknownFields:[]},source(changed,"changed-equipment"),legacy);
    expect(next.facts.find(row=>row.value==="乙设备")?.supersedesFactIds).toEqual([old.id]);
    expect(next.facts.find(row=>row.value==="借用工具")?.supersedesFactIds).toEqual([]);
  });

  it("does not let the lower mutation layer turn an empty target set into whole-field deletion", () => {
    const legacy=student(), first="获准参观甲展厅。";
    const initial=applySelfReportedFactsV7(createStudentProfileV7(legacy),{facts:[fact("access.scope","甲展厅",first)],unknownFields:[]},source(first,"first"),legacy);
    const text="另获准使用乙展厅。";
    const next=applyProfileMutationsV7(initial,[{operation:"set",field:"access.scope",value:"乙展厅",state:"affirmed",targetFactIds:[],quote:text}],source(text,"second"),legacy);
    expect(next.facts.filter(row=>row.field==="access.scope")).toHaveLength(2);
  });
});

describe("a supported retained grant and a complete future action are not missing targets", () => {
  it("retains the existing grant while adopting an additional location and an independent upload denial", async () => {
    const legacy=student(), first="我获准在工作站保存文件。";
    const profile=applySelfReportedFactsV7(createStudentProfileV7(legacy),{facts:[fact("storage.location","工作站",first)],unknownFields:[]},source(first,"workstation"),legacy);
    const old=profile.facts.find(row=>row.field==="storage.location")!;
    const text="更正保存安排：工作站仍可用，另获准在移动盘备份；不得公开上传。";
    const reply=await draftDecisionChatV7({profile,legacy},text,[],{...source(text,"backup"),modelCall:async()=>success([fact("storage.location","移动盘","另获准在移动盘备份"),fact("storage.upload",true,"不得公开上传","negated")])});
    expect(reply.profile?.facts.find(row=>row.id===old.id)).toEqual(old);
    expect(reply.profile?.facts.filter(row=>row.field==="storage.location")).toHaveLength(2);
    expect(reply.profile?.facts.find(row=>row.field==="storage.upload")?.state).toBe("negated");
  });

  it("does not assume a retained grant from an unknown or another person's prior assertion", async () => {
    for(const [field,state] of [["storage.location","unknown"],["storage.location","affirmed"],["other.storage.location","affirmed"]] as const){
      const legacy=student(), first="工作站目前尚未获准使用。";
      const profile=applySelfReportedFactsV7(createStudentProfileV7(legacy),{facts:[fact(field,"工作站",first,state)],unknownFields:[]},source(first,"not-own-grant"),legacy);
      const text="工作站仍可用，另获准在移动盘备份。";
      const reply=await draftDecisionChatV7({profile,legacy},text,[],{...source(text,"unsupported-retention"),modelCall:async()=>success([fact("storage.location","移动盘","另获准在移动盘备份")])});
      expect(reply.profile).toBeUndefined();expect(reply.message).toContain("暂未解析成功");
    }
  });

  it("adopts an already expressed conditional action and a current negative commitment", async () => {
    const text="如果排期允许，我可能重新报名整理；现在还不承诺。";
    const reply=await draftDecisionChatV7({profile:createStudentProfileV7(student())},text,[],{...source(text,"future-action"),modelCall:async()=>success([fact("action.plan","possible","如果排期允许，我可能重新报名整理","conditional"),fact("action.committed","committed","现在还不承诺","negated")],[{sourceText:"重新报名整理",kind:"target"}])});
    expect(reply.profile?.facts.find(row=>row.field==="action.plan")).toMatchObject({state:"conditional",confirmed:false});
    expect(reply.profile?.facts.find(row=>row.field==="action.committed")?.state).toBe("negated");
  });

  it("still clarifies a real missing correction target inside future wording", async () => {
    const text="如果方便，我可能更正那个数字。";
    const result=await extractSelfReportedFactsV7({utterance:text,requestedFields:[],allowNewDomainFields:true},{modelCall:async()=>success([fact("action.plan","correction",text,"conditional")],[{sourceText:"更正那个数字",kind:"target"}])});
    expect(result.facts).toEqual([]);expect(result.clarification).toContain("哪一项条件");
  });
});
