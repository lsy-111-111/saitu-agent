import "./mock-publication-boundary";
import { describe,it,expect } from "vitest";
import { scoreNativeDecision } from "@/lib/competitions/v6/native-score";
import { buildDecisionContext } from "@/lib/competitions/v6/engine";
import { createStudentProfile } from "@/lib/competitions/v6/profile";
import { student,syntheticRecord } from "./decision-fixtures";

describe("A1 common native scoring",()=>{
  it("gives identical evidence identical scores regardless of old/new series identity or migration origin",()=>{
    const legacy=student({goals:["project"],skills:["data-analysis"],taskFormats:["modeling"],interests:["data"],preferredOutputs:["research-paper"],confirmedFields:["stage","goals","skills","taskFormats","interests","preferredOutputs","weeklyCommitment"],decisionContext:{experiences:[{id:"e1",task:"独立清洗问卷数据",contribution:"independent",completion:"delivered",challenge:"",confirmed:true}]}});
    const old=syntheticRecord(1);old.migration.origin="legacy_135";
    const added={...old,recordId:"new-series.2026",seriesId:"new-series",migration:{...old.migration,origin:"verified_expansion" as const}};
    const profile=createStudentProfile(legacy);
    expect(scoreNativeDecision(old,profile)).toEqual(scoreNativeDecision(added,profile));
    const context=buildDecisionContext(legacy,{records:[old,added]});
    expect(context.candidates.map(c=>c.nativeScore?.lower)).toEqual([context.candidates[0].nativeScore!.lower,context.candidates[0].nativeScore!.lower]);
    expect(context.candidates[0].nativeScore!.lower).toBeGreaterThan(60);
  });
  it("does not import a score advantage from a real legacy scorer entry",()=>{
    const legacy=student({skills:["data-analysis"],confirmedFields:["stage","skills"]});
    const existing=buildDecisionContext(legacy).candidates.find(c=>c.score!==null)!;
    expect(existing).toBeDefined();
    const copy={...existing.record,recordId:"identity-only-new-copy",seriesId:"unregistered-new-copy",migration:{...existing.record.migration,origin:"verified_expansion" as const}};
    const paired=buildDecisionContext(legacy,{records:[existing.record,copy]});
    expect(paired.candidates).toHaveLength(2);
    expect(paired.candidates.find(c=>c.record===copy)?.score).toBeNull();
    expect(paired.candidates[0].nativeScore).toEqual(paired.candidates[1].nativeScore);
  });
  it("ranks a better supported new candidate ahead of an unrelated legacy-origin candidate",()=>{
    const legacy=student({taskFormats:["modeling"],skills:["data-analysis"],confirmedFields:["stage","skills","taskFormats"]});
    const old=syntheticRecord(1);old.migration.origin="legacy_135";old.taskFamily="software-algorithms";old.skills=["programming"];old.roles[0].skills=["programming"];
    const fresh=syntheticRecord(2);
    const context=buildDecisionContext(legacy,{records:[old,fresh]});
    expect(context.candidates[0].record.recordId).toBe(fresh.recordId);
    expect(context.candidates[0].nativeScore!.lower).toBeGreaterThan(context.candidates[1].nativeScore!.lower);
  });
  it("applies an explicit task refusal to new series without a legacy scorer",()=>{
    const record=syntheticRecord(8);record.taskFamily="software-algorithms";
    const context=buildDecisionContext(student({decisionContext:{excludedTaskFormats:["software"]}}),{records:[record]});
    expect(context.candidates).toEqual([]);
    expect(context.excluded.get(record.recordId)).toContain("不想做");
  });
  it("keeps missing evidence uncertain and distinguishes observed from delivered contribution",()=>{
    const record=syntheticRecord(1), empty=scoreNativeDecision(record,createStudentProfile(student()));
    expect(empty.upper).toBe(100);expect(empty.lower).toBe(0);
    const profile=(contribution:"observed"|"independent")=>createStudentProfile(student({decisionContext:{experiences:[{id:"e",task:"清洗问卷数据",contribution,completion:"delivered",challenge:"",confirmed:true}]}}));
    expect(scoreNativeDecision(record,profile("independent")).lower).toBeGreaterThan(scoreNativeDecision(record,profile("observed")).lower);
  });
  it("uses the registered five dimensions and keeps self-described skills separate from experience",()=>{
    const record=syntheticRecord(1),profile=createStudentProfile(student({skills:["data-analysis"],confirmedFields:["stage","skills"]}));
    const score=scoreNativeDecision(record,profile);
    expect(score.dimensions.map(({name,weight})=>({name,weight}))).toEqual([{name:"goal",weight:30},{name:"task",weight:25},{name:"experience",weight:20},{name:"preparation",weight:15},{name:"growth",weight:10}]);
    expect(score.dimensions.find(d=>d.name==="experience")).toMatchObject({lower:0,upper:20,studentFactIds:[]});
    expect(score.dimensions.find(d=>d.name==="goal")).toMatchObject({lower:0,upper:30});
    expect(score.upper).toBe(100);
  });
});
