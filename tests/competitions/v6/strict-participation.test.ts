import {describe,expect,it} from "vitest";
import {assessStrictParticipation,assessNowRegistration} from "../../../scripts/competitions/v6/coverage-participation";
import {getCoverageProfiles} from "@/lib/competitions/v6/catalog";
import {syntheticRecord} from "./decision-fixtures";
import type {ParticipationRequirements} from "@/lib/competitions/v6/catalog-types";
import {validateDecisionRecord} from "@/lib/competitions/v6/catalog-validation";

const now=new Date("2026-11-06T00:00:00Z"),profile=getCoverageProfiles()[0];
function fixture(){
  const record=syntheticRecord(991);
  record.sources[0].locator="合成测试专用完整条件段落";
  record.sources[0].scope=record.scope="合成测试专用当前届次及参与范围";
  record.facts[0].scope=record.scope;record.facts[0].status="verified_current";
  record.roles[0].personalDeliverable="能够逐步复现的数据清理笔记";
  record.review={status:"human_reviewed",reviewerIds:["synthetic-contract-reviewer"],reviewedAt:now.toISOString()};
  const add=(key:string)=>{const id=`fixture.${key}`;record.facts.push({...record.facts[0],id,field:key,text:`合成合同测试${key}条件明确，非真实赛事证据。`});return [id];};
  record.registration={status:"open",checkedAt:now.toISOString(),factIds:add("registration.open"),note:"合成合同测试"};
  const values={teamSize:{minimum:1,maximum:1},mentor:false,laboratory:false,equipment:["个人电脑"],attendance:"remote",weeklyHours:2};
  record.participationRequirements=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value,factIds:add(`participation.${key}`)}])) as ParticipationRequirements;
  record.participationRequirements.weeklyHours.meaning="official_complete_path_weekly_bound";
  return record;
}
describe("strict coverage independently requires resources and current participation",()=>{
  it("keeps the legacy official contract parseable but requires a published full plan for strict coverage",()=>{
    expect(assessNowRegistration(fixture(),now)).toBe(true);
    expect(assessStrictParticipation(fixture(),profile,now).reasons).toContain("published_formal_participation_plan_required");
  });
  it("never infers missing requirements or stale registration from an affordable fee",()=>{
    const record=fixture();delete record.participationRequirements;
    expect(assessStrictParticipation(record,profile,now).passed).toBe(false);
    const stale=fixture();stale.registration.checkedAt="2026-11-01T00:00:00Z";
    expect(assessNowRegistration(stale,now)).toBe(false);
    const historical=fixture();historical.registration.status="historical";
    expect(assessStrictParticipation(historical,profile,now).passed).toBe(false);
  });
  it.each([
    ["teamSize",{minimum:2,maximum:3}], ["mentor",true], ["laboratory",true],
    ["equipment",["独立GPU服务器"]], ["attendance","travel"], ["weeklyHours",40],
  ])("rejects an unmet %s requirement even if all facts are sourced",(key,value)=>{
    const record=fixture();(record.participationRequirements![key as keyof ParticipationRequirements] as {value:unknown}).value=value;
    expect(assessStrictParticipation(record,{...profile,team:"can_form",mentor:true,laboratory:true},now).passed).toBe(false);
  });
  it("rejects cross-edition or non-resource facts reused as resource evidence",()=>{
    const record=fixture();record.participationRequirements!.equipment.factIds=[record.facts[0].id];
    expect(assessStrictParticipation(record,profile,now).reasons).toContain("equipment_requirements_not_verified");
    const other=fixture();other.facts.find(f=>f.field==="participation.equipment")!.scope="不同届次范围";
    expect(assessStrictParticipation(other,profile,now).passed).toBe(false);
  });
  it.each([["teamSize",false],["equipment",false],["attendance",""],["weeklyHours",undefined],["mentor","false"],["laboratory",0]])("rejects malformed JSON for %s instead of treating it as no requirement",(key,value)=>{
    const record=fixture();(record.participationRequirements![key as keyof ParticipationRequirements] as {value:unknown}).value=value;
    expect(assessStrictParticipation(record,profile,now).passed).toBe(false);
    expect(validateDecisionRecord(record,now).issues.some(issue=>issue.code==="invalid_participation_requirements")).toBe(true);
  });
});
