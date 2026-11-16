import type { DecisionContextV6 } from "./engine";
import type { StudentProfileV6 } from "./contracts";
import { isDecisionEvidenceFact } from "./evidence";
function withoutProofIds(value: unknown): unknown {
  if(Array.isArray(value))return value.map(withoutProofIds);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([key])=>key!=="factIds"&&key!=="id"&&key!=="stageId").map(([key,item])=>[key,withoutProofIds(item)]));
  return value;
}
/** Ranking reads business values, not the evidence locator graph. The complete
 * source records, rules and fact bodies remain in the server registry; selected
 * suggestions are independently checked against that original evidence.
 */
export function rankingDecisionTable(context: DecisionContextV6) {
  return context.candidates.map(candidate=>{
    const record=candidate.record,learnable=record.roles.findIndex(role=>role.prerequisite==="learnable"),role=record.roles[learnable<0?0:learnable];
    const cost=record.cost,verifiedCost=Boolean(cost?.factIds.length&&cost.factIds.every(id=>record.facts.some(fact=>fact.id===id&&fact.status==="verified_current"&&fact.kind==="official_fact"&&fact.scope===cost.scope&&isDecisionEvidenceFact(record,fact))));
    return{
      itemId:record.recordId,seriesId:record.seriesId,name:record.name,
      edition:record.edition,track:record.track.name,group:record.group,scope:record.scope,
      taskFamily:record.taskFamily,
      tasks:record.sections.task.map(({text,kind,conditions})=>({text,kind,conditions})),
      reviewedRole:role?{name:role.name,task:role.task,skills:role.skills,prerequisite:role.prerequisite,personalDeliverable:role.personalDeliverable}:null,
      outcomes:{forms:record.preferredOutputs,benefits:record.sections.benefits.map(({text,kind,conditions})=>({text,kind,conditions}))},
      eligibility:candidate.eligibility,conditions:[...candidate.conditions],
      personalCost:cost?{minimumPersonalCny:cost.minimumPersonalCny,maximumPersonalCny:cost.maximumPersonalCny,scope:cost.scope,note:cost.note,verifiedCurrent:verifiedCost}:null,
      teamResourcesAndTime:record.participationRequirements?withoutProofIds(record.participationRequirements):null,
      registration:withoutProofIds(record.registration),milestones:record.milestones?withoutProofIds(record.milestones):null,
      difficulty:record.difficulty.map(({stage,summary,assumptions})=>({stage,summary,assumptions})),
    };
  });
}
export function rankingStudentTable(profile:StudentProfileV6){
  return{goals:profile.goals,primaryGoal:profile.primaryGoal,tradeoffStatus:profile.tradeoffStatus,mode:profile.mode,unknownFields:profile.unknownFields,
    facts:profile.facts.filter(fact=>fact.confirmed&&fact.state!=="unknown"&&fact.state!=="retracted"&&!profile.retractedFactIds.includes(fact.id))
      .map(({field,value,label,state,evidenceLevel,originalText})=>({field,value,label,state,evidenceLevel,...(originalText?{originalText}:{})}))};
}
