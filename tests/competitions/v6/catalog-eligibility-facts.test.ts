import {expect,it} from "vitest";
import {authoredEligibilityFacts} from "@/lib/competitions/v6/catalog-eligibility-facts";
import {researchedContents} from "@/content/competitions-v6/research-records";
import {getAuthoredDecisionCatalog} from "@/lib/competitions/v6/catalog";

it("binds an eligibility atom to its actual source and preserves historical status",()=>{
  const content=structuredClone(researchedContents[0]),source=content.sources[0];
  content.factStatus="historical";
  content.eligibilityFacts=[{idSuffix:"fullTime",text:"本通知只适用于全日制学生",sourceIds:[source.id]}];
  expect(authoredEligibilityFacts(content)).toEqual([expect.objectContaining({field:"eligibility.fullTime",status:"historical",sourceIds:[source.id],scope:source.scope,sourceScopes:[{sourceId:source.id,scope:source.scope}]})]);
  content.eligibilityFacts[0].sourceIds=["unknown-source"];
  expect(()=>authoredEligibilityFacts(content)).toThrow("Missing authored eligibility source");
  content.eligibilityFacts[0].sourceIds=[source.id];content.eligibilityFacts.push({...content.eligibilityFacts[0]});
  expect(()=>authoredEligibilityFacts(content)).toThrow("Invalid authored eligibility fact");
});
it("never replaces a specific classical recital fee clause with a generic free-entry claim",()=>{
  const records=getAuthoredDecisionCatalog().filter(record=>record.seriesId==="chinese-classics"&&record.cost);
  expect(records.length).toBeGreaterThan(0);
  for(const record of records){
    const fact=record.facts.find(fact=>record.cost!.factIds.includes(fact.id));
    expect(record.cost!.note).toContain(fact!.text);
    expect(record.cost!.minimumPersonalCny).toBeNull();expect(record.cost!.maximumPersonalCny).toBeNull();
  }
});

it("keeps scoped unknown qualifications separate from official evidence",()=>{
  const content=structuredClone(researchedContents[0]);
  content.factStatus="historical";
  content.eligibilityFacts=[{idSuffix:"pastQualification",text:"未取得该届资格原文，不能确认当年个人报名资格",kind:"unknown",sourceIds:[],scope:"历史学习资料；不支持当前报名判断"}];
  expect(authoredEligibilityFacts(content)).toEqual([expect.objectContaining({kind:"unknown",status:"unknown",sourceIds:[],sourceScopes:[],scope:"历史学习资料；不支持当前报名判断",checkedAt:null})]);
  content.eligibilityFacts[0].status="verified_current";
  expect(()=>authoredEligibilityFacts(content)).toThrow("Invalid unknown eligibility fact");
  content.eligibilityFacts[0].status="unknown";content.eligibilityFacts[0].sourceIds=[content.sources[0].id];
  expect(()=>authoredEligibilityFacts(content)).toThrow("Invalid unknown eligibility fact");
  content.eligibilityFacts[0].sourceIds=[];content.eligibilityFacts[0].scope=" ";
  expect(()=>authoredEligibilityFacts(content)).toThrow("Invalid unknown eligibility fact");
  content.eligibilityFacts[0].kind="official_fact";
  expect(()=>authoredEligibilityFacts(content)).toThrow("Invalid authored eligibility fact");
});
