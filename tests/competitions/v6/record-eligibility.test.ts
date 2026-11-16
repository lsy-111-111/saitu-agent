import "./mock-publication-boundary";
import { describe, expect, it } from "vitest";
import { buildDecisionContext } from "@/lib/competitions/v6/engine";
import { createStudentProfile, applyProfileMutations } from "@/lib/competitions/v6/profile";
import { evaluateRecordEligibility } from "@/lib/competitions/v6/eligibility";
import { validateDecisionRecord } from "@/lib/competitions/v6/catalog-validation";
import { student, syntheticRecord } from "./decision-fixtures";
function currentRecord(){const record=syntheticRecord(40);record.registration.status="unknown";record.facts[0].field="eligibility";record.facts[0].status="verified_current";record.eligibilityRules=[{id:"undergrad",field:"degree",operator:"in",value:["undergraduate"],factIds:[record.facts[0].id],note:"在校本科生"}];return record;}
describe("catalog-native qualifications for new series",()=>{
  it("keeps pending confirmation placeholders unknown and rejects using them as hard eligibility rules",()=>{
    const record=currentRecord();record.facts[0].status="pending_review";
    record.eligibilityRules=[{id:"individual",field:"teamSize",operator:"requires_confirmation",value:"个人报名条件仍待核实",factIds:[record.facts[0].id],note:"缺少适用报名原文，个人报名条件仍待核实"}];
    const legacy=student(),profile=createStudentProfile(legacy);
    expect(validateDecisionRecord(record).issues.some(issue=>issue.code==="unsupported_eligibility_rule")).toBe(false);
    const text="我确认个人报名";
    const confirmed=applyProfileMutations(profile,[{operation:"set",field:"qualification.individual",value:true,targetFactIds:[],quote:text}],{answerId:"pending-rule",text,at:"2026-11-05T10:00:00.000Z"},legacy);
    expect(evaluateRecordEligibility(record,confirmed)?.status).toBe("unknown");
    record.eligibilityRules[0].operator="eq";record.eligibilityRules[0].value=1;
    expect(validateDecisionRecord(record).issues.some(issue=>issue.code==="unsupported_eligibility_rule")).toBe(true);
    expect(evaluateRecordEligibility(record,confirmed)?.status).toBe("unknown");
  });
  it("uses confirmed solo preparation only as a current count and respects explicit or revoked facts",()=>{
    const record=currentRecord();record.eligibilityRules=[{id:"individual",field:"teamSize",operator:"eq",value:1,factIds:[record.facts[0].id],note:"个人参赛"}];
    const profile=createStudentProfile(student({teamStatus:"solo",confirmedFields:["stage","teamStatus"]}));
    expect(evaluateRecordEligibility(record,profile)?.status).toBe("eligible");
    record.eligibilityRules[0].value=3;
    expect(evaluateRecordEligibility(record,profile)?.status).toBe("unknown");
    record.eligibilityRules[0].value=1;
    const solo=profile.facts.find(f=>f.field==="teamStatus")!;
    for(const state of ["unknown","conditional","retracted","negated"] as const){
      solo.state=state;expect(evaluateRecordEligibility(record,profile)?.status).toBe("unknown");
    }
    solo.state="affirmed";solo.confirmed=false;expect(evaluateRecordEligibility(record,profile)?.status).toBe("unknown");
    solo.confirmed=true;profile.retractedFactIds.push(solo.id);expect(evaluateRecordEligibility(record,profile)?.status).toBe("unknown");
    profile.retractedFactIds=[];solo.value="ready";expect(evaluateRecordEligibility(record,profile)?.status).toBe("unknown");
    solo.value="solo";
    profile.facts.push({...solo,id:"explicit-team-count",field:"eligibility.teamSize",value:3});
    expect(evaluateRecordEligibility(record,profile)?.status).toBe("unknown");
    profile.facts.push({...solo,id:"fixed-team",field:"fixedTeam",value:true});
    expect(evaluateRecordEligibility(record,profile)?.status).toBe("ineligible");
  });
  it("can establish a new series qualification without a legacy scorer entry",()=>{
    const record=currentRecord();const context=buildDecisionContext(student(),{records:[record]});
    expect(context.candidates[0].eligibility).toBe("eligible");
    expect(context.candidates[0].conditions.join(" ")).not.toContain("尚未接入结构化资格规则");
  });
  it("excludes a proven current conflict but keeps unknown and historical rules conditional",()=>{
    const record=currentRecord();const postgraduate=student({stage:"master"});
    expect(buildDecisionContext(postgraduate,{records:[record]}).candidates).toHaveLength(0);
    record.facts[0].status="historical";
    expect(buildDecisionContext(postgraduate,{records:[record]}).candidates[0].eligibility).toBe("unknown");
    record.facts[0].status="verified_current";
    expect(buildDecisionContext(student({confirmedFields:[]}),{records:[record]}).candidates[0].eligibility).toBe("unknown");
  });
  it("requires a scoped user confirmation for institutional exceptions and does not infer it from stage",()=>{
    const record=currentRecord();record.eligibilityRules!.push({id:"school-nomination",field:"institution",operator:"requires_confirmation",value:"学院确认名额",factIds:[record.facts[0].id],note:"学院已经确认报名名额"});
    const legacy=student(), profile=createStudentProfile(legacy);
    expect(evaluateRecordEligibility(record,profile)?.status).toBe("unknown");
    const text="学院已经确认我的名额";
    const confirmed=applyProfileMutations(profile,[{operation:"set",field:"qualification.school-nomination",value:true,targetFactIds:[],quote:text}],{answerId:"nomination-confirmed",text,at:"2026-11-05T10:00:00.000Z"},legacy);
    expect(evaluateRecordEligibility(record,confirmed)?.status).toBe("eligible");
    record.facts[0].scope="另一赛道";
    expect(evaluateRecordEligibility(record,confirmed)?.status).toBe("unknown");
  });
  it("accepts exact composite bindings but rejects extra sources or a different track",()=>{
    const record=currentRecord();const entity={editionId:"2026",trackId:"undergrad",groupId:"student",scopeId:"national"};record.identity={...entity,stageIds:[],supersedesRecordIds:[],legacyRecordIds:[]};
    const second={...record.sources[0],id:"second-official",scope:"院系补充条件"};record.sources.push(second);
    const fact=record.facts[0];fact.scope="两份来源的适用条件";fact.sourceIds.push(second.id);fact.sourceScopes=record.sources.map(source=>({sourceId:source.id,scope:source.scope}));fact.entity={...entity};
    expect(evaluateRecordEligibility(record,createStudentProfile(student()))?.status).toBe("eligible");
    fact.entity.trackId="graduate";expect(evaluateRecordEligibility(record,createStudentProfile(student()))?.status).toBe("unknown");fact.entity.trackId="undergrad";
    fact.sourceScopes.push({sourceId:"unregistered",scope:"假来源"});expect(evaluateRecordEligibility(record,createStudentProfile(student()))?.status).toBe("unknown");fact.sourceScopes.pop();
    fact.sourceScopes[0].scope="另一届";expect(evaluateRecordEligibility(record,createStudentProfile(student()))?.status).toBe("unknown");
  });

  it("uses confirmed boolean negation as false, not missing qualification",()=>{
    const record=currentRecord();record.eligibilityRules=[{id:"mentor-required",field:"mentor",operator:"eq",value:true,factIds:[record.facts[0].id],note:"需要导师"}];
    const legacy=student(),profile=createStudentProfile(legacy),text="我没有导师";
    const next=applyProfileMutations(profile,[{operation:"set",field:"eligibility.mentor",value:false,state:"negated",targetFactIds:[],quote:text}],{answerId:"mentor-negative",text,at:new Date().toISOString()},legacy);
    expect(evaluateRecordEligibility(record,next)?.status).toBe("ineligible");
  });

});
