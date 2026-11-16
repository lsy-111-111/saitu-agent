import "./mock-publication-boundary";
import { describe, expect, it } from "vitest";
import { applyProfileMutations, createStudentProfile, projectProfileToLegacy } from "@/lib/competitions/v6/profile";
import { buildDecisionContext, buildRuleMatchPlan, buildRuleDecisionReport, selectUsefulQuestions } from "@/lib/competitions/v6/engine";
import { student, syntheticRecord } from "./decision-fixtures";

const at="2026-11-05T10:00:00.000Z";
describe("v6 confirmed fact updates",()=>{
  it("keeps source quote and replacement lineage while withdrawing old budget evidence",()=>{
    const original=student({decisionContext:{budget:{range:"100-500",maximumYuan:300,scope:"personal"}}});
    const profile=createStudentProfile(original);
    const previous=profile.facts.find(f=>f.field==="budget.maximumYuan")!;
    const next=applyProfileMutations(profile,[{operation:"set",field:previous.field,value:0,targetFactIds:[previous.id],quote:"预算改为0元"}],{answerId:"answer-2",text:"我的预算改为0元",at},original);
    const fact=next.facts.find(f=>f.field===previous.field)!;
    expect(fact.supersedesFactIds).toEqual([previous.id]);
    expect(fact.originalText).toBe("预算改为0元");
    expect(fact.updatedAt).toBe(at);
    expect(next.retractedFactIds).toContain(previous.id);
    expect(next.facts.some(f=>f.id===previous.id)).toBe(false);
    expect(next.revision).not.toBe(profile.revision);
    expect(next.updates?.[0].previousRevision).toBe(profile.revision);
    expect(projectProfileToLegacy(next,original).decisionContext?.budget).toEqual({range:"zero",scope:"personal"});
  });
  it("rejects foreign facts, forged quotes and unsupported enum values before confirmation can commit",()=>{
    const original=student(),profile=createStudentProfile(original);
    const source={answerId:"a2",text:"每周投入很少",at};
    expect(()=>applyProfileMutations(profile,[{operation:"set",field:"weeklyCommitment",value:"under-5",targetFactIds:["another-student"],quote:source.text}],source,original)).toThrow();
    expect(()=>applyProfileMutations(profile,[{operation:"set",field:"weeklyCommitment",value:"under-5",targetFactIds:[],quote:"未说过的话"}],source,original)).toThrow();
    expect(()=>applyProfileMutations(profile,[{operation:"set",field:"weeklyCommitment",value:"infinite",targetFactIds:[],quote:source.text}],source,original)).toThrow();
  });
  it("uses actual per-experience contribution for order and role, then removes the advantage when corrected",()=>{
    const programming=syntheticRecord(2); programming.taskFamily="software-algorithms";
    programming.roles=[{...programming.roles[0],name:"说明与汇报",skills:["presentation"]},{...programming.roles[0],name:"程序实现",skills:["programming"]}];
    const data=syntheticRecord(1);
    const original=student({decisionContext:{experiences:[{id:"first",task:"独立编写Python文件整理工具",contribution:"independent",completion:"delivered",challenge:"排查路径错误",confirmed:true}]}});
    const context=buildDecisionContext(original,{records:[data,programming]});
    expect(buildRuleMatchPlan(context).recommendations[0].itemId).toBe(programming.recordId);
    const report=buildRuleDecisionReport(original,{records:[data,programming]});
    expect(report.recommendations[0].currentRole.text).toContain("程序实现");
    expect(report.recommendations[0].reasons[0].studentFactIds).toContain(context.profile.facts.find(f=>f.field==="experience.1.task")!.id);
    const source={answerId:"correction-1",text:"其实程序是队友做的，我只是旁观",at};
    const next=applyProfileMutations(context.profile,[{operation:"set",field:"experience.1.contribution",value:"observed",targetFactIds:[],quote:source.text}],source,original);
    const corrected=buildRuleDecisionReport(original,{records:[data,programming],profile:next});
    expect(corrected.recommendations[0].itemId).toBe(data.recordId);
    expect(corrected.recommendations.find(item=>item.itemId===programming.recordId)?.currentRole.text).toContain("说明与汇报");
    expect(corrected.recommendations.flatMap(item=>item.reasons).some(reason=>reason.studentFactIds.includes(context.profile.facts.find(f=>f.field==="experience.1.contribution")!.id))).toBe(false);
  });
  it("retracting a task removes dependent contribution and completion without erasing the update audit",()=>{
    const original=student({decisionContext:{experiences:[{id:"first",task:"清洗问卷数据",contribution:"assisted",completion:"draft",challenge:"",confirmed:true}]}});
    const profile=createStudentProfile(original), task=profile.facts.find(f=>f.field==="experience.1.task")!;
    const text="撤销第一段经历";
    const next=applyProfileMutations(profile,[{operation:"retract",field:task.field,targetFactIds:[task.id],quote:text}],{answerId:"withdraw-1",text,at},original);
    expect(next.facts.some(f=>f.field.startsWith("experience.1."))).toBe(false);
    expect(next.updates?.[0].removedFactIds).toHaveLength(3);
    expect(projectProfileToLegacy(next,original).decisionContext?.experiences).toEqual([]);
  });
  it("only asks an unanswered question when counterfactuals change a candidate decision",()=>{
    const empty=buildDecisionContext(student(),{records:[]});
    expect(selectUsefulQuestions(empty)).toEqual([]);
    const context=buildDecisionContext(student(),{records:[syntheticRecord(1)]});
    expect(selectUsefulQuestions(context)[0].field).toBe("weeklyCommitment");
    expect(selectUsefulQuestions(context)[0].candidateIds).toEqual([syntheticRecord(1).recordId]);
    const known=buildDecisionContext(student({weeklyCommitment:"under-5",teamStatus:"solo",confirmedFields:["stage","weeklyCommitment","teamStatus"]}),{records:[syntheticRecord(1)]});
    expect(selectUsefulQuestions(known)).toEqual([]);
  });
});
