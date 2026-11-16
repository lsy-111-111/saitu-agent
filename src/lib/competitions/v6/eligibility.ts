import type { CatalogEligibilityRule, DecisionCompetitionRecord } from "./catalog-types";
import type { StudentFactV6, StudentProfileV6 } from "./contracts";
import { activeStudentFacts } from "./profile";
import { isDecisionEvidenceFact,isEvidenceForRecord } from "./evidence";

type EligibilityConflictEvidence = { rule: CatalogEligibilityRule; condition: string; studentFactIds: string[] };

export function evaluateRecordEligibility(record: DecisionCompetitionRecord, profile: StudentProfileV6,
  onConflict?: (conflict: EligibilityConflictEvidence) => void): {status:"eligible"|"unknown"|"ineligible";conditions:string[];ruleIds:string[]} | null {
  if(!record.eligibilityRules?.length)return null;
  const active=activeStudentFacts(profile);
  const facts=active.filter(f=>f.state==="affirmed"||f.state==="negated"&&typeof f.value==="boolean");
  const fieldFacts=(field:string)=>facts.filter(f=>f.field===field);
  const last=(field:string)=>facts.findLast(f=>f.field===field);
  const one=(field:string)=>last(field)?.value;
  const fromFact=(value:unknown,fact?:StudentFactV6)=>({value,studentFactIds:fact?[fact.id]:[]});
  const observed=(rule:CatalogEligibilityRule):{value:unknown;studentFactIds:string[]}=>{
    if(rule.operator==="requires_confirmation") {
      const confirmation=last(`qualification.${rule.id}`);
      return fromFact(confirmation?.value,confirmation);
    }
    const explicit=last(`eligibility.${rule.field}`);if(explicit)return fromFact(explicit.value,explicit);
    const stageFact=last("stage"),enrollmentFact=last("enrollmentStatus");
    const stage=stageFact?.value,enrollment=enrollmentFact?.value;
    switch(rule.field){
      case "degree":return fromFact(typeof stage==="string"?stage.startsWith("undergraduate")?"undergraduate":["master","doctorate","vocational"].includes(stage)?stage:undefined:undefined,stageFact);
      case "year":return fromFact(typeof stage==="string"&&stage.startsWith("undergraduate-")?Number(stage.split("-")[1]):undefined,stageFact);
      case "enrolled":return fromFact(enrollment==="full-time-student"||enrollment==="part-time-student"?true:enrollment==="graduated"?false:undefined,enrollmentFact);
      case "fullTime":return fromFact(enrollment==="full-time-student"?true:enrollment==="part-time-student"||enrollment==="graduated"?false:undefined,enrollmentFact);
      case "teamSize": {
        const explicitSize = last("teamSize");
        if (explicitSize) return fromFact(({solo:1,two:2,three:3,four:4,five:5} as Record<string,number>)[String(explicitSize.value)],explicitSize);
        // "Currently preparing alone" establishes the current count, not a
        // fixed team, access to a mentor, or permission to enter a team event.
        const team=last("teamStatus");
        return fromFact(team?.value==="solo"?1:undefined,team);
      }
      case "sameInstitutionTeam": {
        const team=last("teamUnit");
        return fromFact(team?.value==="same-unit"?true:team?.value==="mixed-unit"?false:undefined,team);
      }
      case "major": {
        const subjects=fieldFacts("specificSubjects");
        return {value:subjects.length?subjects.map(f=>f.value):undefined,studentFactIds:subjects.map(f=>f.id)};
      }
      case "mentor": {
        const mentor=fieldFacts("availableResources").find(f=>f.value==="mentor");
        if(mentor)return fromFact(true,mentor);
        const unavailable=active.find(f=>f.field==="unavailableResource"&&f.value==="mentor");
        return fromFact(unavailable?false:undefined,unavailable);
      }
      default:return fromFact(undefined);
    }
  };
  const conditions:string[]=[],ruleIds:string[]=[];let unknown=false,ineligible=false;
  for(const rule of record.eligibilityRules){
    ruleIds.push(rule.id);
    const supporting=rule.factIds.map(id=>record.facts.find(f=>f.id===id));
    const supported=rule.factIds.length>0&&supporting.every(f=>f&&f.kind==="official_fact"&&f.field.startsWith("eligibility")&&isEvidenceForRecord(record,f)&&isDecisionEvidenceFact(record,f));
    const current=supported&&supporting.every(f=>f?.status==="verified_current");
    if(!supported){unknown=true;conditions.push(`资格规则尚缺适用原文支持：${rule.note}`);continue;}
    const {value,studentFactIds}=observed(rule);
    if(value===undefined){unknown=true;conditions.push(`待确认资格条件：${rule.note || String(rule.value)}`);continue;}
    const actual=Array.isArray(value)?value:[value],expected=Array.isArray(rule.value)?rule.value:[rule.value];
    // Broad field labels never prove a narrow official major or institutional condition.
    const matches=(x:unknown,y:unknown)=>x===y||(x==="master"||x==="doctorate")&&y==="postgraduate";
    let passes=rule.operator==="requires_confirmation"?value===true:rule.operator==="eq"?actual.some(x=>matches(x,rule.value)):rule.operator==="in"?actual.some(x=>expected.some(y=>matches(x,y))):rule.operator==="not_in"?actual.every(x=>expected.every(y=>!matches(x,y))):typeof value==="number"&&typeof rule.value==="number"?(rule.operator==="min"?value>=rule.value:value<=rule.value):undefined;
    if(rule.field==="major"&&passes===false&&!facts.some(f=>f.field==="eligibility.major")){passes=undefined;}
    const adjustable=["teamSize","sameInstitutionTeam","sameCountryTeam"].includes(rule.field)&&one("fixedTeam")!==true;
    if(!current){unknown=true;conditions.push(`历史资格规则仅供准备参考，当前届次需重核：${rule.note}`);}
    else if(passes===undefined||(!passes&&adjustable)){unknown=true;conditions.push(`需确认或调整参与条件：${rule.note}`);}
    else if(!passes){
      ineligible=true;
      const condition=`与你确认的条件冲突：${rule.note}`;
      conditions.push(condition);
      const fixedTeam=["teamSize","sameInstitutionTeam","sameCountryTeam"].includes(rule.field)?last("fixedTeam"):undefined;
      onConflict?.({rule,condition,studentFactIds:fixedTeam?[...studentFactIds,fixedTeam.id]:studentFactIds});
    }
  }
  return {status:ineligible?"ineligible":unknown?"unknown":"eligible",conditions,ruleIds};
}
